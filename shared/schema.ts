import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  friendCode: varchar("friend_code", { length: 8 }).notNull().unique(),
  createdAt: timestamp("created_at").defaultNow(),
  lastSeen: timestamp("last_seen"),
});

export const roomStatusEnum = pgEnum("room_status", ["waiting", "in_progress", "finished"]);
export const gameModeEnum = pgEnum("game_mode_type", ["free_for_all", "teams"]);

export const rooms = pgTable("rooms", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: varchar("code", { length: 6 }).notNull().unique(),
  hostUserId: varchar("host_user_id").references(() => users.id),
  status: roomStatusEnum("status").default("waiting").notNull(),
  gameMode: gameModeEnum("game_mode").default("free_for_all").notNull(),
  maxPlayers: integer("max_players").default(4).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const roomPlayers = pgTable("room_players", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  roomId: varchar("room_id").references(() => rooms.id).notNull(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  seatIndex: integer("seat_index").notNull(),
  team: varchar("team", { length: 1 }),
});

export const friendStatusEnum = pgEnum("friend_status", ["pending", "accepted"]);

export const friends = pgTable("friends", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  friendUserId: varchar("friend_user_id").references(() => users.id).notNull(),
  status: friendStatusEnum("status").default("pending").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
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
