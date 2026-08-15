import { eq, and, or, sql, inArray } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { db } from "./db";
import { users, rooms, roomPlayers, friends, activeGames } from "@shared/schema";
import type { User, InsertUser, Room, RoomPlayer, Friend } from "@shared/schema";

export type SeatClaim =
  | { ok: true; seatIndex: number }
  | { ok: false; reason: "no_room" | "not_waiting" | "full" | "already_joined" };

export interface JoinableRoom {
  room: Room;
  playerCount: number;
  containsUser: boolean;
}

export interface IStorage {
  deleteUser(userId: string): Promise<void>;
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  searchUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateLastSeen(userId: string): Promise<void>;

  createRoom(hostUserId: string, gameMode: "free_for_all" | "teams", maxPlayers: number): Promise<Room>;
  getRoomByCode(code: string): Promise<Room | undefined>;
  getRoomById(id: string): Promise<Room | undefined>;
  updateRoomStatus(roomId: string, status: "waiting" | "in_progress" | "finished"): Promise<void>;
  updateRoomGameMode(roomId: string, gameMode: "free_for_all" | "teams"): Promise<void>;
  updateRoomHost(roomId: string, hostUserId: string): Promise<void>;

  getRoomPlayers(roomId: string): Promise<(RoomPlayer & { user: User })[]>;
  addRoomPlayer(roomId: string, userId: string, seatIndex: number): Promise<void>;
  upsertRoomPlayer(roomId: string, userId: string, seatIndex: number): Promise<void>;
  claimRoomSeat(roomId: string, userId: string): Promise<SeatClaim>;
  getWaitingRooms(roomIds: string[], userId: string): Promise<JoinableRoom[]>;
  removeRoomPlayer(roomId: string, userId: string): Promise<void>;
  clearRoomPlayers(roomId: string): Promise<void>;

  getFriends(userId: string): Promise<(Friend & { friend: User })[]>;
  getPendingFriendRequests(userId: string): Promise<(Friend & { requester: User })[]>;
  getSentFriendRequests(userId: string): Promise<(Friend & { recipient: User })[]>;
  hasPendingRequest(userId: string, friendUserId: string): Promise<boolean>;
  addFriend(userId: string, friendUserId: string): Promise<void>;
  acceptFriend(id: string, accepterId: string): Promise<{ requesterId: string } | null>;
  areFriends(userId: string, friendUserId: string): Promise<boolean>;
  removeFriend(userId: string, friendUserId: string): Promise<void>;
  declineFriendRequest(id: string, recipientId: string): Promise<boolean>;
  cancelFriendRequest(requestId: string, fromUserId: string): Promise<boolean>;
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
  // Math.random().toString(36).substring(2, 8) could return fewer than 6
  // characters and was predictable enough to guess a live room.
  return randomCode(6);
}

class DrizzleStorage implements IStorage {
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
          .where(inArray(activeGames.roomCode, hostedIds));
        await tx.delete(rooms).where(inArray(rooms.id, hostedIds));
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

  async getUserByUsername(username: string) {
    const [user] = await db.select().from(users).where(eq(users.username, username));
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
        return user;
      } catch (err: any) {
        if (err?.constraint?.includes("friend_code") && attempt < 9) continue;
        throw err;
      }
    }
    throw new Error("Failed to generate unique friend code");
  }

  async updateLastSeen(userId: string): Promise<void> {
    await db.update(users).set({ lastSeen: new Date() }).where(eq(users.id, userId));
  }

  async createRoom(hostUserId: string, gameMode: "free_for_all" | "teams", maxPlayers: number): Promise<Room> {
    let code = generateRoomCode();
    for (let i = 0; i < 10; i++) {
      const existing = await this.getRoomByCode(code);
      if (!existing) break;
      code = generateRoomCode();
    }
    const [room] = await db.insert(rooms).values({
      code,
      hostUserId,
      status: "waiting",
      gameMode,
      maxPlayers,
    }).returning();
    return room;
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

  async updateRoomGameMode(roomId: string, gameMode: "free_for_all" | "teams") {
    await db.update(rooms).set({ gameMode }).where(eq(rooms.id, roomId));
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
   * Idempotent seat write. `game:rejoin` used to INSERT unconditionally on
   * every reconnect, growing room_players without bound and corrupting the
   * seat -> hand mapping on the next rematch.
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
   * Allocates the lowest free seat under a row lock on the room, replacing the
   * old check-then-act `seatIndex = players.length`, where two simultaneous
   * joins were handed the same seat.
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
   * one round trip. The quickmatch loop used to issue two queries per
   * candidate room (N+1) while the matchmaking request waited.
   */
  async getWaitingRooms(
    roomIds: string[],
    userId: string
  ): Promise<JoinableRoom[]> {
    if (roomIds.length === 0) return [];
    const rows = await db
      .select({
        room: rooms,
        playerCount: sql<number>`count(${roomPlayers.id})`,
        containsUser: sql<boolean>`coalesce(bool_or(${roomPlayers.userId} = ${userId}), false)`,
      })
      .from(rooms)
      .leftJoin(roomPlayers, eq(roomPlayers.roomId, rooms.id))
      .where(and(inArray(rooms.id, roomIds), eq(rooms.status, "waiting")))
      .groupBy(rooms.id);

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

  async clearRoomPlayers(roomId: string) {
    await db.delete(roomPlayers).where(eq(roomPlayers.roomId, roomId));
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

  async hasPendingRequest(userId: string, friendUserId: string): Promise<boolean> {
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
    return !!row;
  }

  async addFriend(userId: string, friendUserId: string) {
    await db.insert(friends).values({ userId, friendUserId, status: "pending" });
  }

  /**
   * Only the recipient of a pending request may accept it. Previously any
   * caller could accept any request by id — including the sender accepting
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

  async searchUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.username}) = lower(${username})`);
    return user;
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
