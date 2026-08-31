import { eq, and, or, sql, desc, inArray, isNull } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { db } from "./db.ts";
import {
  users,
  rooms,
  roomPlayers,
  friends,
  gameInvites,
  activeGames,
  matchReplays,
} from "../shared/schema.ts";
import type { User, InsertUser, Room, RoomPlayer, Friend, RoomVisibility } from "../shared/schema.ts";

export type SeatClaim =
  | { ok: true; seatIndex: number }
  | { ok: false; reason: "no_room" | "not_waiting" | "full" | "already_joined" };

export interface JoinableRoom {
  room: Room;
  playerCount: number;
  containsUser: boolean;
}

/** The constraint a 23505 names, or undefined if the error is something else. */
function uniqueViolation(err: unknown): string | undefined {
  for (let e = err; e; e = (e as { cause?: unknown }).cause) {
    const { code, constraint } = e as { code?: string; constraint?: string };
    if (code === "23505" && constraint) return constraint;
  }
  return undefined;
}

/** The pre-check at POST /api/auth/register cannot see a concurrent insert. */
export class UsernameTakenError extends Error {
  constructor() {
    super("Username already taken");
  }
}

// No O/0/I/1 — same alphabet as the friend codes, so a code read aloud or
// typed from a screenshot is unambiguous.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(length: number): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

function generateRoomCode(): string {
  // Cryptographically random and always exactly 6 characters — a live room
  // code must not be guessable.
  return randomCode(6);
}

class DrizzleStorage {
  /**
   * Apple requires in-app account deletion to actually work. Every row that
   * references users.id has to go, or the final DELETE trips a foreign key and
   * the endpoint 500s: friends (both directions), room_players, the rooms this
   * user hosts (plus their players and any persisted game), and the sessions.
   */
  async deleteUser(userId: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .delete(friends)
        .where(or(eq(friends.userId, userId), eq(friends.friendUserId, userId)));

      await tx.delete(roomPlayers).where(eq(roomPlayers.userId, userId));

      const hosted = await tx
        .select({ id: rooms.id })
        .from(rooms)
        .where(eq(rooms.hostUserId, userId));
      const hostedIds = hosted.map((r) => r.id);

      if (hostedIds.length > 0) {
        await tx.delete(roomPlayers).where(inArray(roomPlayers.roomId, hostedIds));
        await tx
          .delete(activeGames)
          .where(inArray(activeGames.roomId, hostedIds));
        await tx.delete(rooms).where(inArray(rooms.id, hostedIds));
      }

      // Every other table that names a user carries a cascading foreign key.
      // match_replays cannot: a replay belongs to up to four players, so it
      // holds their ids and display names inside jsonb instead. Deleting the
      // rows outright would take other players' replays with it, so the
      // departing player is erased from them instead — id out of the ownership
      // filter, name out of the seat — and a replay nobody is left to open is
      // then removed.
      const theirReplays = await tx
        .select({ id: matchReplays.id, playerIds: matchReplays.playerIds, seats: matchReplays.seats })
        .from(matchReplays)
        .where(sql`${matchReplays.playerIds} @> ${JSON.stringify([userId])}::jsonb`);

      for (const row of theirReplays) {
        const playerIds = row.playerIds.filter((id) => id !== userId);
        if (playerIds.length === 0) {
          await tx.delete(matchReplays).where(eq(matchReplays.id, row.id));
          continue;
        }
        // An empty name is the signal to the client to render its own
        // localized "deleted player" label — the row itself keeps no wording.
        const seats = row.seats.map((seat) =>
          seat.userId === userId ? { ...seat, userId: null, name: "" } : seat
        );
        await tx
          .update(matchReplays)
          .set({ playerIds, seats })
          .where(eq(matchReplays.id, row.id));
      }

      await tx.execute(
        sql`DELETE FROM session WHERE sess->>'userId' = ${userId}`
      );

      await tx.delete(users).where(eq(users.id, userId));
    });
  }

  async getUser(id: string) {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.username}) = lower(${username})`);
    return user;
  }

  private generateFriendCode(): string {
    return randomCode(6);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const friendCode = this.generateFriendCode();
        const [user] = await db
          .insert(users)
          .values({ ...insertUser, friendCode })
          .returning();
        if (!user) throw new Error("createUser: insert returned no row");
        return user;
      } catch (err) {
        // drizzle-orm wraps the driver error in a DrizzleQueryError, so the
        // constraint name is on the cause, not on what was thrown.
        const violated = uniqueViolation(err);
        if (violated?.includes("friend_code") && attempt < 9) continue;
        if (violated?.includes("username")) throw new UsernameTakenError();
        throw err;
      }
    }
    throw new Error("Failed to generate unique friend code");
  }

  /**
   * Throws `UsernameTakenError` when the name is another account's. Both unique constraints can
   * raise it — the column's own, and `users_username_lower_uq` on `lower(username)` — so a caller
   * that checked first still has to catch: the check and the write are not one transaction.
   */
  async renameUser(userId: string, username: string): Promise<User> {
    try {
      const [user] = await db
        .update(users)
        .set({ username })
        .where(eq(users.id, userId))
        .returning();
      if (!user) throw new Error("renameUser: no such user");
      return user;
    } catch (err) {
      if (uniqueViolation(err)?.includes("username")) throw new UsernameTakenError();
      throw err;
    }
  }

  async updateLastSeen(userId: string): Promise<void> {
    await db.update(users).set({ lastSeen: new Date() }).where(eq(users.id, userId));
  }

  /** First time only: the answer is "has it ever been offered", so the first date is the true one. */
  async markTutorialSeen(userId: string): Promise<void> {
    await db
      .update(users)
      .set({ tutorialSeenAt: new Date() })
      .where(and(eq(users.id, userId), isNull(users.tutorialSeenAt)));
  }

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
    visibility: RoomVisibility = "private"
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
  }

  async getRoomByCode(code: string) {
    const [room] = await db.select().from(rooms).where(eq(rooms.code, code));
    return room;
  }

  async getRoomById(id: string) {
    const [room] = await db.select().from(rooms).where(eq(rooms.id, id));
    return room;
  }

  async updateRoomStatus(roomId: string, status: "waiting" | "in_progress" | "finished") {
    await db.update(rooms).set({ status }).where(eq(rooms.id, roomId));
  }

  async updateRoomHost(roomId: string, hostUserId: string) {
    await db.update(rooms).set({ hostUserId }).where(eq(rooms.id, roomId));
  }

  async getRoomPlayers(roomId: string): Promise<(RoomPlayer & { user: User })[]> {
    const rows = await db
      .select()
      .from(roomPlayers)
      .innerJoin(users, eq(roomPlayers.userId, users.id))
      .where(eq(roomPlayers.roomId, roomId))
      .orderBy(roomPlayers.seatIndex);

    return rows.map((r) => ({ ...r.room_players, user: r.users }));
  }

  async addRoomPlayer(roomId: string, userId: string, seatIndex: number) {
    await db.insert(roomPlayers).values({ roomId, userId, seatIndex });
  }

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
  }

  /**
   * Allocates the lowest free seat under a row lock on the room, so two
   * simultaneous joins cannot race into the same seat.
   */
  async claimRoomSeat(roomId: string, userId: string): Promise<SeatClaim> {
    return db.transaction(async (tx): Promise<SeatClaim> => {
      const [room] = await tx
        .select()
        .from(rooms)
        .where(eq(rooms.id, roomId))
        .for("update");
      if (!room) return { ok: false, reason: "no_room" };
      if (room.status !== "waiting") return { ok: false, reason: "not_waiting" };

      const seated = await tx
        .select()
        .from(roomPlayers)
        .where(eq(roomPlayers.roomId, roomId));

      if (seated.some((p) => p.userId === userId))
        return { ok: false, reason: "already_joined" };
      if (seated.length >= room.maxPlayers) return { ok: false, reason: "full" };

      const taken = new Set(seated.map((p) => p.seatIndex));
      let seatIndex = 0;
      while (taken.has(seatIndex)) seatIndex++;
      if (seatIndex >= room.maxPlayers) return { ok: false, reason: "full" };

      await tx.insert(roomPlayers).values({ roomId, userId, seatIndex });
      return { ok: true, seatIndex };
    });
  }

  /**
   * Every still-waiting room out of a candidate set, with its seat count, in
   * one round trip — avoids an N+1 query pattern while the matchmaking
   * request waits.
   */
  /**
   * Every public room still waiting for players, newest last so the fullest
   * room fills first rather than four arrivals opening four rooms.
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
  }

  async removeRoomPlayer(roomId: string, userId: string) {
    await db.delete(roomPlayers).where(
      and(eq(roomPlayers.roomId, roomId), eq(roomPlayers.userId, userId))
    );
  }

  async getFriends(userId: string): Promise<(Friend & { friend: User })[]> {
    const rows = await db
      .select()
      .from(friends)
      .innerJoin(users, eq(friends.friendUserId, users.id))
      .where(and(eq(friends.userId, userId), eq(friends.status, "accepted")));

    return rows.map((r) => ({ ...r.friends, friend: r.users }));
  }

  async getPendingFriendRequests(userId: string): Promise<(Friend & { requester: User })[]> {
    const rows = await db
      .select()
      .from(friends)
      .innerJoin(users, eq(friends.userId, users.id))
      .where(and(eq(friends.friendUserId, userId), eq(friends.status, "pending")));

    return rows.map((r) => ({ ...r.friends, requester: r.users }));
  }

  /**
   * Which way a pending request between these two runs, or null.
   *
   * The direction is the whole answer: told "already sent" for a request that
   * is in fact waiting on *them*, a player has no way to learn that accepting
   * it is what they should do.
   */
  async pendingRequestBetween(
    userId: string,
    friendUserId: string
  ): Promise<"sent" | "received" | null> {
    const [row] = await db
      .select()
      .from(friends)
      .where(
        and(
          or(
            and(eq(friends.userId, userId), eq(friends.friendUserId, friendUserId)),
            and(eq(friends.userId, friendUserId), eq(friends.friendUserId, userId))
          ),
          eq(friends.status, "pending")
        )
      );
    if (!row) return null;
    return row.userId === userId ? "sent" : "received";
  }

  async addFriend(userId: string, friendUserId: string) {
    await db.insert(friends).values({ userId, friendUserId, status: "pending" });
  }

  /**
   * Only the recipient of a pending request may accept it — otherwise any
   * caller could accept any request by id, including the sender accepting
   * their own (IDOR).
   */
  async acceptFriend(
    id: string,
    accepterId: string
  ): Promise<{ requesterId: string } | null> {
    const [f] = await db
      .update(friends)
      .set({ status: "accepted" })
      .where(
        and(
          eq(friends.id, id),
          eq(friends.friendUserId, accepterId),
          eq(friends.status, "pending")
        )
      )
      .returning();
    if (!f) return null;

    const exists = await this.areFriends(f.friendUserId, f.userId);
    if (!exists) {
      await db.insert(friends).values({
        userId: f.friendUserId,
        friendUserId: f.userId,
        status: "accepted",
      });
    }
    return { requesterId: f.userId };
  }

  async areFriends(userId: string, friendUserId: string): Promise<boolean> {
    const [row] = await db
      .select()
      .from(friends)
      .where(
        and(
          eq(friends.userId, userId),
          eq(friends.friendUserId, friendUserId),
          eq(friends.status, "accepted")
        )
      );
    return !!row;
  }

  /**
   * Records that one player asked another to join a room, and returns whether
   * the invite is new. Re-inviting the same person to the same room refreshes
   * the existing row rather than adding a second — so an impatient host and a
   * retried emit are the same event.
   */
  async recordGameInvite(
    roomId: string,
    inviterId: string,
    inviteeId: string
  ): Promise<{ created: boolean }> {
    const [row] = await db
      .insert(gameInvites)
      .values({ roomId, inviterId, inviteeId })
      .onConflictDoUpdate({
        target: [gameInvites.roomId, gameInvites.inviteeId],
        set: { inviterId, createdAt: new Date() },
      })
      .returning({ createdAt: gameInvites.createdAt, id: gameInvites.id });
    return { created: !!row };
  }

  /**
   * The rooms this player has been asked to join and can still join.
   *
   * Both halves of "can still join" are checked, because `claimRoomSeat`
   * refuses `full` and `not_waiting` separately: a room nobody has started can
   * still have no seat left, and offering that invite sends the player at a
   * door that will not open. Deleting rows is hygiene; this is the guarantee.
   */
  async getGameInvites(
    inviteeId: string
  ): Promise<{ id: string; roomCode: string; fromUsername: string; createdAt: Date }[]> {
    const seatCount = db
      .select({ count: sql<number>`count(*)::int` })
      .from(roomPlayers)
      .where(eq(roomPlayers.roomId, gameInvites.roomId));
    const rows = await db
      .select({
        id: gameInvites.id,
        roomCode: rooms.code,
        fromUsername: users.username,
        createdAt: gameInvites.createdAt,
      })
      .from(gameInvites)
      .innerJoin(rooms, eq(gameInvites.roomId, rooms.id))
      .innerJoin(users, eq(gameInvites.inviterId, users.id))
      .where(
        and(
          eq(gameInvites.inviteeId, inviteeId),
          eq(rooms.status, "waiting"),
          sql`(${seatCount}) < ${rooms.maxPlayers}`
        )
      )
      .orderBy(desc(gameInvites.createdAt));
    return rows;
  }

  /**
   * Drops a room's invites once it can no longer be joined, and says who held
   * them. An invite is a pointer to a room, so it must not outlive one — and
   * the people it has to stop pointing for are exactly the rows just deleted.
   */
  async clearGameInvites(roomId: string): Promise<string[]> {
    const cleared = await db
      .delete(gameInvites)
      .where(eq(gameInvites.roomId, roomId))
      .returning({ inviteeId: gameInvites.inviteeId });
    return cleared.map((row) => row.inviteeId);
  }

  /** Who holds an invite to this room, leaving the rows alone. */
  async getRoomInvitees(roomId: string): Promise<string[]> {
    const held = await db
      .select({ inviteeId: gameInvites.inviteeId })
      .from(gameInvites)
      .where(eq(gameInvites.roomId, roomId));
    return held.map((row) => row.inviteeId);
  }

  /**
   * Turns one invite down. Addressed by room code rather than row id because
   * the unique index makes (invitee, room) name exactly one row, which also
   * makes a repeated decline a no-op instead of an error.
   */
  async declineGameInvite(inviteeId: string, roomCode: string): Promise<void> {
    await db.delete(gameInvites).where(
      and(
        eq(gameInvites.inviteeId, inviteeId),
        inArray(
          gameInvites.roomId,
          db.select({ id: rooms.id }).from(rooms).where(eq(rooms.code, roomCode))
        )
      )
    );
  }

  async removeFriend(userId: string, friendUserId: string): Promise<void> {
    await db.delete(friends).where(
      or(
        and(eq(friends.userId, userId), eq(friends.friendUserId, friendUserId)),
        and(eq(friends.userId, friendUserId), eq(friends.friendUserId, userId))
      )
    );
  }

  /** Only the recipient may decline a pending request. */
  async declineFriendRequest(id: string, recipientId: string): Promise<boolean> {
    const deleted = await db
      .delete(friends)
      .where(
        and(
          eq(friends.id, id),
          eq(friends.friendUserId, recipientId),
          eq(friends.status, "pending")
        )
      )
      .returning({ id: friends.id });
    return deleted.length > 0;
  }


  async getSentFriendRequests(userId: string): Promise<(Friend & { recipient: User })[]> {
    const rows = await db
      .select()
      .from(friends)
      .innerJoin(users, eq(friends.friendUserId, users.id))
      .where(and(eq(friends.userId, userId), eq(friends.status, "pending")));
    return rows.map((r) => ({ ...r.friends, recipient: r.users }));
  }

  /** Only the sender may cancel their own pending request. */
  async cancelFriendRequest(requestId: string, fromUserId: string): Promise<boolean> {
    const deleted = await db
      .delete(friends)
      .where(
        and(eq(friends.id, requestId), eq(friends.userId, fromUserId), eq(friends.status, "pending"))
      )
      .returning({ id: friends.id });
    return deleted.length > 0;
  }
}

export const storage = new DrizzleStorage();

export const __testables = { uniqueViolation };
