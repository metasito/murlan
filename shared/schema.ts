import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, pgEnum, jsonb, boolean, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";
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
  // as soon as a seat is vacated, so relying on it can hand a rejoining
  // player someone else's hand.
  playerMap:  jsonb("player_map").notNull().default({}),
  // userId -> cumulative match points, so a restart does not reset the match.
  scores:     jsonb("scores").notNull().default({}),
  isPublic:   boolean("is_public").notNull().default(false),
  maxPlayers: integer("max_players").notNull().default(4),
  gameMode:   text("game_mode").notNull().default("free_for_all"),
  matchTarget: integer("match_target").notNull().default(21),
  // "match" (play to matchTarget) or "single" (one manche and done).
  matchLength: text("match_length").notNull().default("match"),
  updatedAt:  timestamp("updated_at").defaultNow().notNull(),
});

export const userStats = pgTable("user_stats", {
  userId: varchar("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  gamesPlayed: integer("games_played").notNull().default(0),
  gamesWon: integer("games_won").notNull().default(0),
  matchesWon: integer("matches_won").notNull().default(0),
  currentStreak: integer("current_streak").notNull().default(0),
  bestStreak: integer("best_streak").notNull().default(0),
  bombsPlayed: integer("bombs_played").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const matchHistory = pgTable("match_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  finishedAt: timestamp("finished_at").defaultNow().notNull(),
  gameMode: text("game_mode").notNull(),
  placement: integer("placement").notNull(),
  playerCount: integer("player_count").notNull(),
  points: integer("points").notNull(),
  opponents: jsonb("opponents").notNull().default([]),
}, (t) => [index("match_history_user_idx").on(t.userId, t.finishedAt)]);

export const userAchievements = pgTable("user_achievements", {
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  achievementId: text("achievement_id").notNull(),
  unlockedAt: timestamp("unlocked_at").defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.achievementId] })]);

// One finished manche, replayable by anyone who sat at it. Its own table rather
// than a column on match_history: a write to a missing table fails alone, and a
// replay belongs to the table rather than to any one player's history row.
export const matchReplays = pgTable("match_replays", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  roomCode: text("room_code").notNull(),
  finishedAt: timestamp("finished_at").defaultNow().notNull(),
  gameMode: text("game_mode").notNull(),
  // The seated userIds, bots excluded — what a player's own list is read through.
  playerIds: jsonb("player_ids").notNull().default([]),
  seats: jsonb("seats").notNull().default([]),
  moves: jsonb("moves").notNull().default([]),
  rankings: jsonb("rankings").notNull().default([]),
}, (t) => [
  index("match_replays_finished_idx").on(t.finishedAt),
  // Every read of this table filters on `player_ids @> '["<uid>"]'`. Containment
  // is not a btree predicate — only a GIN index can answer it.
  index("match_replays_player_ids_idx").using("gin", t.playerIds),
]);

// One row per player per season. `season` is part of the key rather than a
// value that gets overwritten, so a reset is a new row and the previous
// season stays readable.
export const userRatings = pgTable("user_ratings", {
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  season: text("season").notNull(),
  rating: integer("rating").notNull(),
  games: integer("games").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.season] }),
  index("user_ratings_season_idx").on(t.season, t.rating),
]);

/**
 * One row per device a player has granted notification permission on.
 *
 * Keyed by the token itself, not a surrogate id: Expo's token is globally
 * unique, and a device re-registering must overwrite its row rather than
 * accumulate a second one, which an upsert on the natural key does in one
 * statement. `userId` is a plain column so a device changing hands reassigns
 * rather than duplicates.
 */
export const pushTokens = pgTable("push_tokens", {
  token: text("token").primaryKey(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  platform: text("platform").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("push_tokens_user_id_idx").on(t.userId),
]);

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Room = typeof rooms.$inferSelect;
export type RoomPlayer = typeof roomPlayers.$inferSelect;
export type Friend = typeof friends.$inferSelect;
export type UserStats = typeof userStats.$inferSelect;
export type MatchHistory = typeof matchHistory.$inferSelect;
export type UserAchievement = typeof userAchievements.$inferSelect;
