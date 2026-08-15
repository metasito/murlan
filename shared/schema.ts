import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, pgEnum, jsonb, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  friendCode: varchar("friend_code", { length: 6 }).notNull().unique(),
  createdAt: timestamp("created_at").defaultNow(),
  lastSeen: timestamp("last_seen"),
});

export const roomStatusEnum = pgEnum("room_status", ["waiting", "in_progress", "finished"]);
export const gameModeEnum = pgEnum("game_mode_type", ["free_for_all", "teams"]);

export const rooms = pgTable(
  "rooms",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    code: varchar("code", { length: 6 }).notNull().unique(),
    hostUserId: varchar("host_user_id").references(() => users.id),
    status: roomStatusEnum("status").default("waiting").notNull(),
    gameMode: gameModeEnum("game_mode").default("free_for_all").notNull(),
    maxPlayers: integer("max_players").default(4).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [
    index("rooms_host_user_id_idx").on(t.hostUserId),
    index("rooms_status_idx").on(t.status),
  ]
);

export const roomPlayers = pgTable(
  "room_players",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    roomId: varchar("room_id").references(() => rooms.id).notNull(),
    userId: varchar("user_id").references(() => users.id).notNull(),
    seatIndex: integer("seat_index").notNull(),
    team: varchar("team", { length: 1 }),
  },
  (t) => [
    index("room_players_room_id_idx").on(t.roomId),
    index("room_players_user_id_idx").on(t.userId),
    // One row per user per room, and one user per seat: makes rejoin inserts
    // idempotent and makes simultaneous joins collide instead of sharing a seat.
    uniqueIndex("room_players_room_user_uq").on(t.roomId, t.userId),
    uniqueIndex("room_players_room_seat_uq").on(t.roomId, t.seatIndex),
  ]
);

export const friendStatusEnum = pgEnum("friend_status", ["pending", "accepted"]);

export const friends = pgTable(
  "friends",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").references(() => users.id).notNull(),
    friendUserId: varchar("friend_user_id").references(() => users.id).notNull(),
    status: friendStatusEnum("status").default("pending").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [
    index("friends_user_id_idx").on(t.userId),
    index("friends_friend_user_id_idx").on(t.friendUserId),
  ]
);

export const activeGames = pgTable("active_games", {
  roomCode:   text("room_code").primaryKey(),
  gameState:  jsonb("game_state").notNull().default({}),
  playerIds:  jsonb("player_ids").notNull().default([]),
  // seatIndex -> userId. Authoritative: player_ids loses the seat association
  // as soon as a seat is vacated, which used to hand players the wrong hand.
  playerMap:  jsonb("player_map").notNull().default({}),
  // userId -> cumulative match points, so a restart does not reset the match.
  scores:     jsonb("scores").notNull().default({}),
  isPublic:   boolean("is_public").notNull().default(false),
  maxPlayers: integer("max_players").notNull().default(4),
  gameMode:   text("game_mode").notNull().default("free_for_all"),
  matchTarget: integer("match_target").notNull().default(21),
  updatedAt:  timestamp("updated_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Room = typeof rooms.$inferSelect;
export type RoomPlayer = typeof roomPlayers.$inferSelect;
export type Friend = typeof friends.$inferSelect;
