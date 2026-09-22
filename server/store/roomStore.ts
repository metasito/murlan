import { eq, and, asc, sql } from "drizzle-orm";
import { db } from "./db.ts";
import { users, rooms, roomPlayers, gameInvites } from "../../shared/schema.ts";
import type { User, Room, RoomPlayer, RoomVisibility } from "../../shared/schema.ts";
import { heldSeats, seatForClaim } from "../game/seatAllocation.ts";
import type { SeatHold, SeatInvite, SeatedPlayer, SeatingRoom } from "../game/seatAllocation.ts";
import { seatHoldMs } from "../game/gameTimers.ts";
import { randomCode } from "./codes.ts";

export type SeatClaim =
  | { ok: true; seatIndex: number; room: Room }
  | { ok: false; reason: "already_joined"; room: Room }
  | { ok: false; reason: "no_room" | "not_waiting" | "full" | "held" | "not_public" | "empty" };

type SeatedUser = RoomPlayer & { user: User };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type StartClose =
  | { ok: true; room: Room; roster: SeatedUser[] }
  | { ok: false; reason: "no_room" | "not_host" | "not_waiting" }
  | { ok: false; reason: "refused"; roster: SeatedUser[] };

/** Seating, release and start each take this first, so none reads a roster another is changing. */
async function lockRoom(tx: Tx, roomId: string): Promise<Room | undefined> {
  const [room] = await tx.select().from(rooms).where(eq(rooms.id, roomId)).for("update");
  return room;
}

async function seatedUsers(tx: Tx | typeof db, roomId: string): Promise<SeatedUser[]> {
  const rows = await tx
    .select()
    .from(roomPlayers)
    .innerJoin(users, eq(roomPlayers.userId, users.id))
    .where(eq(roomPlayers.roomId, roomId))
    .orderBy(asc(roomPlayers.seatIndex));
  return rows.map((r) => ({ ...r.room_players, user: r.users }));
}

export interface JoinableRoom {
  room: Room;
  playerCount: number;
  containsUser: boolean;
}

function generateRoomCode(): string {
  // Cryptographically random and always exactly 6 characters — a live room
  // code must not be guessable.
  return randomCode(6);
}

/**
 * An object rather than bare exported functions:
 * `tests/integration/reconnect.test.ts` replaces `getRoomPlayers` with a
 * throwing stub to drive the failure paths, and an ES module's namespace is
 * sealed against exactly that.
 */
export const roomStore = {
  /**
   * Lets the unique constraint decide the code, the same way `createUser` does
   * for friend codes.
   *
   * Checking first and then inserting cannot be right: between the check and
   * the insert another caller can take the code, and the previous loop also
   * generated a replacement after its last failed check and inserted that one
   * unverified. The constraint is the only thing that can settle it, so the
   * insert asks it and retries on the answer.
   */
  async createRoom(
    hostUserId: string,
    gameMode: "free_for_all" | "teams",
    maxPlayers: number,
    visibility: RoomVisibility = "private",
    autoStart = false
  ): Promise<Room> {
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const [room] = await db.insert(rooms).values({
          code: generateRoomCode(),
          hostUserId,
          status: "waiting",
          gameMode,
          maxPlayers,
          visibility,
          autoStart,
        }).returning();
        if (!room) throw new Error("createRoom: insert returned no row");
        return room;
      } catch (err) {
        const constraint = (err as { constraint?: string })?.constraint;
        if (constraint?.includes("code") && attempt < 9) continue;
        throw err;
      }
    }
    throw new Error("Failed to generate a free room code");
  },

  async getRoomByCode(code: string) {
    const [room] = await db.select().from(rooms).where(eq(rooms.code, code));
    return room;
  },

  async getRoomById(id: string) {
    const [room] = await db.select().from(rooms).where(eq(rooms.id, id));
    return room;
  },

  async updateRoomStatus(roomId: string, status: "waiting" | "in_progress" | "finished") {
    await db.update(rooms).set({ status }).where(eq(rooms.id, roomId));
  },

  async updateRoomVisibility(roomId: string, visibility: RoomVisibility) {
    await db.update(rooms).set({ visibility }).where(eq(rooms.id, roomId));
  },

  async getRoomPlayers(roomId: string): Promise<SeatedUser[]> {
    return seatedUsers(db, roomId);
  },

  /**
   * Closes the lobby to a start: host and status checked, roster read and the
   * room set `in_progress`, all under the row lock a claim or a release waits
   * on, so the roster dealt is the roster seated. `liveMatch` admits a room
   * still reading `in_progress` from the match that just ended.
   *
   * `renumber` closes gaps in the seat numbers, because an all-human engine
   * seats by roster position and a rejoin writes that position back.
   */
  async closeForStart(
    roomId: string,
    userId: string,
    opts: { liveMatch: boolean; renumber: boolean; admits: (roster: SeatedUser[]) => boolean }
  ): Promise<StartClose> {
    return db.transaction(async (tx): Promise<StartClose> => {
      const room = await lockRoom(tx, roomId);
      if (!room) return { ok: false, reason: "no_room" };
      if (room.hostUserId !== userId) return { ok: false, reason: "not_host" };
      if (!opts.liveMatch && room.status !== "waiting" && room.status !== "finished") {
        return { ok: false, reason: "not_waiting" };
      }
      const roster = await seatedUsers(tx, roomId);
      if (!opts.admits(roster)) return { ok: false, reason: "refused", roster };

      if (opts.renumber) {
        // Ascending, and never upwards, so no step collides on the seat index.
        for (const [position, p] of roster.entries()) {
          if (p.seatIndex === position) continue;
          await tx.update(roomPlayers).set({ seatIndex: position }).where(eq(roomPlayers.id, p.id));
          p.seatIndex = position;
        }
      }
      const [closed] = await tx
        .update(rooms)
        .set({ status: "in_progress" })
        .where(eq(rooms.id, roomId))
        .returning();
      return { ok: true, room: closed!, roster };
    });
  },

  /**
   * Frees a seat and settles who holds the room: a lobby left empty is
   * finished, and otherwise a host who is no longer seated hands it to the
   * lowest seat. `emptied` says this release is the one that finished it.
   */
  async releaseSeat(
    roomId: string,
    userId: string
  ): Promise<{ room: Room; remaining: SeatedUser[]; emptied: boolean } | null> {
    return db.transaction(async (tx) => {
      const room = await lockRoom(tx, roomId);
      if (!room) return null;
      await tx
        .delete(roomPlayers)
        .where(and(eq(roomPlayers.roomId, roomId), eq(roomPlayers.userId, userId)));
      const remaining = await seatedUsers(tx, roomId);

      const emptied = remaining.length === 0 && room.status === "waiting";
      const [next] = remaining;
      const set = emptied
        ? { status: "finished" as const }
        : next && !remaining.some((p) => p.userId === room.hostUserId)
          ? { hostUserId: next.userId }
          : null;
      if (!set) return { room, remaining, emptied };
      const [updated] = await tx.update(rooms).set(set).where(eq(rooms.id, roomId)).returning();
      return { room: updated!, remaining, emptied };
    });
  },

  async addRoomPlayer(roomId: string, userId: string, seatIndex: number) {
    await db.insert(roomPlayers).values({ roomId, userId, seatIndex });
  },

  /**
   * Idempotent seat write — inserting unconditionally on every reconnect
   * would grow room_players without bound and corrupt the seat -> hand
   * mapping on the next rematch.
   */
  async upsertRoomPlayer(roomId: string, userId: string, seatIndex: number) {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(roomPlayers)
        .where(and(eq(roomPlayers.roomId, roomId), eq(roomPlayers.userId, userId)));

      if (!existing) {
        await tx.insert(roomPlayers).values({ roomId, userId, seatIndex });
        return;
      }
      if (existing.seatIndex !== seatIndex) {
        await tx
          .update(roomPlayers)
          .set({ seatIndex })
          .where(eq(roomPlayers.id, existing.id));
      }
    });
  },

  /**
   * Seats a player under a row lock on the room, so two simultaneous joins
   * cannot race into the same seat — and so the invites the hold is read from
   * cannot change between the read and the insert. Quick-match's own filters
   * are asked again here, because its candidate list was read without the lock.
   */
  async claimRoomSeat(
    roomId: string,
    userId: string,
    opts: { requirePublic?: boolean; requireOccupied?: boolean } = {}
  ): Promise<SeatClaim> {
    return db.transaction(async (tx): Promise<SeatClaim> => {
      const room = await lockRoom(tx, roomId);
      if (!room) return { ok: false, reason: "no_room" };
      if (room.status !== "waiting") return { ok: false, reason: "not_waiting" };
      if (opts.requirePublic && room.visibility !== "public") return { ok: false, reason: "not_public" };

      const seated = await tx
        .select()
        .from(roomPlayers)
        .where(eq(roomPlayers.roomId, roomId));

      if (seated.some((p) => p.userId === userId))
        return { ok: false, reason: "already_joined", room };
      if (opts.requireOccupied && seated.length === 0) return { ok: false, reason: "empty" };
      if (seated.length >= room.maxPlayers) return { ok: false, reason: "full" };

      const invites = await tx
        .select({
          inviterId: gameInvites.inviterId,
          inviteeId: gameInvites.inviteeId,
          createdAt: gameInvites.createdAt,
        })
        .from(gameInvites)
        .where(eq(gameInvites.roomId, roomId))
        .orderBy(gameInvites.createdAt, gameInvites.id);

      const seatIndex = seatForClaim({
        room,
        seated,
        invites,
        now: Date.now(),
        holdMs: seatHoldMs(),
        userId,
      });
      if (seatIndex === null) return { ok: false, reason: "held" };

      await tx.insert(roomPlayers).values({ roomId, userId, seatIndex });
      return { ok: true, seatIndex, room };
    });
  },

  /**
   * Which seats this room is holding, for whom, and until when — the room has
   * to say a seat is held and for whom, or the hold reads as the room being
   * broken.
   */
  async getRoomSeatHolds(
    room: SeatingRoom & { id: string },
    seated: readonly SeatedPlayer[]
  ): Promise<(SeatHold & { username: string })[]> {
    const invites: (SeatInvite & { username: string })[] = await db
      .select({
        inviterId: gameInvites.inviterId,
        inviteeId: gameInvites.inviteeId,
        createdAt: gameInvites.createdAt,
        username: users.username,
      })
      .from(gameInvites)
      .innerJoin(users, eq(gameInvites.inviteeId, users.id))
      .where(eq(gameInvites.roomId, room.id))
      .orderBy(gameInvites.createdAt, gameInvites.id);

    const nameOf = new Map(invites.map((i) => [i.inviteeId, i.username]));
    return heldSeats({
      room,
      seated,
      invites,
      now: Date.now(),
      holdMs: seatHoldMs(),
    }).map((hold) => ({ ...hold, username: nameOf.get(hold.inviteeId) ?? "" }));
  },

  /**
   * Every public room still waiting for players, newest last so the fullest
   * room fills first rather than four arrivals opening four rooms. Its seat
   * count comes back in the same round trip, so matchmaking never waits on an
   * N+1 query.
   *
   * Takes no candidate list on purpose. The register that used to supply one
   * lived in this process's memory and only quick-match ever wrote to it, so a
   * restart or a second process made a waiting room permanently unfindable
   * while its row still said "waiting".
   */
  async findWaitingPublicRooms(userId?: string): Promise<JoinableRoom[]> {
    const rows = await db
      .select({
        room: rooms,
        playerCount: sql<number>`count(${roomPlayers.id})`,
        containsUser: userId
          ? sql<boolean>`coalesce(bool_or(${roomPlayers.userId} = ${userId}), false)`
          : sql<boolean>`false`,
      })
      .from(rooms)
      .leftJoin(roomPlayers, eq(roomPlayers.roomId, rooms.id))
      .where(and(eq(rooms.visibility, "public"), eq(rooms.status, "waiting")))
      .groupBy(rooms.id)
      .orderBy(rooms.createdAt);

    return rows.map((r) => ({
      room: r.room,
      playerCount: Number(r.playerCount),
      containsUser: !!r.containsUser,
    }));
  },

  async removeRoomPlayer(roomId: string, userId: string) {
    await db.delete(roomPlayers).where(
      and(eq(roomPlayers.roomId, roomId), eq(roomPlayers.userId, userId))
    );
  },
};
