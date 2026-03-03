import { eq, and, or, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, pool } from "./db";
import { users, rooms, roomPlayers, friends } from "@shared/schema";
import type { User, InsertUser, Room, RoomPlayer, Friend } from "@shared/schema";

export interface IStorage {
  deleteUser(userId: string): Promise<void>;
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByFriendCode(code: string): Promise<User | undefined>;
  searchUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateLastSeen(userId: string): Promise<void>;

  createRoom(hostUserId: string, gameMode: "free_for_all" | "teams", maxPlayers: number): Promise<Room>;
  getRoomByCode(code: string): Promise<Room | undefined>;
  getRoomById(id: string): Promise<Room | undefined>;
  updateRoomStatus(roomId: string, status: "waiting" | "in_progress" | "finished"): Promise<void>;
  updateRoomGameMode(roomId: string, gameMode: "free_for_all" | "teams"): Promise<void>;

  getRoomPlayers(roomId: string): Promise<(RoomPlayer & { user: User })[]>;
  addRoomPlayer(roomId: string, userId: string, seatIndex: number): Promise<void>;
  removeRoomPlayer(roomId: string, userId: string): Promise<void>;
  clearRoomPlayers(roomId: string): Promise<void>;

  getFriends(userId: string): Promise<(Friend & { friend: User })[]>;
  getPendingFriendRequests(userId: string): Promise<(Friend & { requester: User })[]>;
  getSentFriendRequests(userId: string): Promise<(Friend & { recipient: User })[]>;
  hasPendingRequest(userId: string, friendUserId: string): Promise<boolean>;
  addFriend(userId: string, friendUserId: string): Promise<void>;
  acceptFriend(id: string): Promise<{ requesterId: string } | null>;
  areFriends(userId: string, friendUserId: string): Promise<boolean>;
  removeFriend(userId: string, friendUserId: string): Promise<void>;
  declineFriendRequest(id: string): Promise<void>;
  cancelFriendRequest(requestId: string, fromUserId: string): Promise<void>;
}

function generateFriendCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function generateRoomCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

class DrizzleStorage implements IStorage {
  async deleteUser(userId: string): Promise<void> {
    await db.delete(friends).where(
      or(eq(friends.userId, userId), eq(friends.friendUserId, userId))
    );
    await pool.query(
      `DELETE FROM session WHERE sess->>'userId' = $1`,
      [userId]
    );
    await db.delete(users).where(eq(users.id, userId));
  }

  async getUser(id: string) {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string) {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserByFriendCode(code: string) {
    const [user] = await db.select().from(users).where(eq(users.friendCode, code));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    let friendCode = generateFriendCode();
    for (let i = 0; i < 10; i++) {
      const existing = await this.getUserByFriendCode(friendCode);
      if (!existing) break;
      friendCode = generateFriendCode();
    }
    const [user] = await db.insert(users).values({
      ...insertUser,
      friendCode,
    }).returning();
    return user;
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

  async acceptFriend(id: string): Promise<{ requesterId: string } | null> {
    await db.update(friends).set({ status: "accepted" }).where(eq(friends.id, id));
    const [f] = await db.select().from(friends).where(eq(friends.id, id));
    if (f) {
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
    return null;
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

  async declineFriendRequest(id: string): Promise<void> {
    await db.delete(friends).where(eq(friends.id, id));
  }

  async searchUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username));
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

  async cancelFriendRequest(requestId: string, fromUserId: string): Promise<void> {
    await db
      .delete(friends)
      .where(
        and(eq(friends.id, requestId), eq(friends.userId, fromUserId), eq(friends.status, "pending"))
      );
  }
}

export const storage = new DrizzleStorage();
