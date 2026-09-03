import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean, pgEnum, jsonb, index, uniqueIndex, primaryKey, bigserial, customType } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import type { GameState } from "../lib/gameEngine.ts";
import type { PersistedEnvelope } from "../server/onlineGameLogic.ts";
import type { ReplayMove, ReplaySeat } from "../lib/replay.ts";

export const users = pgTable(
  "users",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    username: text("username").notNull().unique(),
    password: text("password").notNull(),
    friendCode: varchar("friend_code", { length: 6 }).notNull().unique(),
    createdAt: timestamp("created_at").defaultNow(),
    lastSeen: timestamp("last_seen"),
    tutorialSeenAt: timestamp("tutorial_seen_at"),
    // One boolean, not a roles table. If a second admin ever exists, that is
    // when a role earns a column.
    isAdmin: boolean("is_admin").notNull().default(false),
    // Nullable so every pre-existing row satisfies it on the day it lands —
    // #34 requires an email at signup going forward, but this column carries
    // no login-time check against the accounts that predate that decision
    // (docs/superpowers/specs/2026-09-03-account-recovery-design.md, Box 1).
    email: text("email"),
    emailVerifiedAt: timestamp("email_verified_at"),
  },
  (t) => [
    uniqueIndex("users_username_lower_uq").on(sql`lower(${t.username})`),
    // Postgres permits any number of NULLs in a unique index, so nullable and
    // unique compose with no special case here.
    uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`),
  ]
);

export const roomStatusEnum = pgEnum("room_status", ["waiting", "in_progress", "finished"]);
export const gameModeEnum = pgEnum("game_mode_type", ["free_for_all", "teams"]);
/**
 * Who may walk in. `public` is what quick-match matches strangers into;
 * `private` is reachable by its code and nothing else. Stored rather than
 * held in memory so a restart cannot make a waiting room unfindable.
 */
export const roomVisibilityEnum = pgEnum("room_visibility", ["public", "private"]);

export const rooms = pgTable(
  "rooms",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    code: varchar("code", { length: 6 }).notNull().unique(),
    hostUserId: varchar("host_user_id").references(() => users.id),
    status: roomStatusEnum("status").default("waiting").notNull(),
    gameMode: gameModeEnum("game_mode").default("free_for_all").notNull(),
    maxPlayers: integer("max_players").default(4).notNull(),
    visibility: roomVisibilityEnum("visibility").default("private").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [
    index("rooms_host_user_id_idx").on(t.hostUserId),
    index("rooms_status_idx").on(t.status),
    index("rooms_open_idx").on(t.visibility, t.status, t.gameMode, t.maxPlayers),
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

/**
 * Who has been asked to join which room.
 *
 * The cascades are deliberate, and a departure from the tables above: an
 * invite is meaningless without its room or either of its users, so the
 * database is what knows that rather than every call site that deletes one.
 * There is no `expires_at` — a clock would be a second source of truth that
 * can disagree with the room, and a room that can no longer be joined already
 * says so in `rooms.status`.
 */
export const gameInvites = pgTable(
  "game_invites",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    roomId: varchar("room_id")
      .references(() => rooms.id, { onDelete: "cascade" })
      .notNull(),
    inviterId: varchar("inviter_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    inviteeId: varchar("invitee_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    // "What have I been invited to" is the only read, and it runs on every
    // app open and every reconnect.
    index("game_invites_invitee_id_idx").on(t.inviteeId),
    index("game_invites_room_id_idx").on(t.roomId),
    // Re-inviting the same person to the same room is one invite, so an
    // impatient host and a retried emit are the same event to the database.
    uniqueIndex("game_invites_room_invitee_uq").on(t.roomId, t.inviteeId),
  ]
);

// One live table. Everything about it rides the versioned `game_state`
// envelope — see `PersistedEnvelope` in server/onlineGameLogic.ts.
export const activeGames = pgTable("active_games", {
  roomId:     text("room_id").primaryKey(),
  gameState:  jsonb("game_state").$type<PersistedEnvelope<GameState>>().notNull(),
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
  /**
   * How this match moved the seat's ladder rating, or null where it moved
   * nothing: an offline match, a teams match, a table that earned no rating,
   * and every row written before this column existed. Null rather than 0 on
   * purpose — 0 is a rated match that happened to move nobody, and a reader
   * cannot tell the two apart if they share a value.
   *
   * Kept here rather than derived later because it cannot be: `user_ratings`
   * holds only the current rating, and `ratingDeltas()` needs every seat's
   * rating and game count as they were *before* the match. Once the match is
   * written those inputs are gone.
   */
  ratingDelta: integer("rating_delta"),
}, (t) => [index("match_history_user_idx").on(t.userId, t.finishedAt)]);

/**
 * What a client crash looked like, kept for CLIENT_ERROR_RETENTION_DAYS so the
 * owner can read it on /admin rather than only in the server's log stream.
 *
 * `userId` is nullable: a crash early enough in a session may not have one, and
 * losing the report would be worse than losing the attribution.
 */
export const clientErrors = pgTable("client_errors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
  appVersion: text("app_version"),
  platform: text("platform"),
  screen: text("screen"),
  message: text("message").notNull(),
  stack: text("stack"),
  context: jsonb("context").notNull().default({}),
  // Computed server-side in recordClientError, never accepted from the
  // client. Null on rows written before this column existed — never
  // backfilled, so they age out on their own via CLIENT_ERROR_RETENTION_DAYS.
  fingerprint: text("fingerprint"),
}, (t) => [
  index("client_errors_occurred_idx").on(t.occurredAt),
  index("client_errors_fingerprint_idx").on(t.fingerprint),
]);

/**
 * What a player says is wrong, in their own words, plus the context they would
 * otherwise have to be asked for. Kept for BUG_REPORT_RETENTION_DAYS.
 *
 * `userId` is not nullable, unlike `client_errors`: the endpoint is
 * authenticated, so a report always has an author, and an anonymous one would
 * be an abuse surface rather than a lost attribution.
 *
 * There is deliberately no game state and no attached crash here. Both were
 * specified and both wait on a privacy policy, because a table's game state
 * carries other players' usernames — everything this table holds is the
 * reporter's own.
 */
export const bugReports = pgTable("bug_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  description: text("description").notNull(),
  screen: text("screen"),
  appVersion: text("app_version"),
  platform: text("platform"),
  locale: text("locale"),
  resolved: boolean("resolved").notNull().default(false),
}, (t) => [index("bug_reports_created_idx").on(t.createdAt)]);

/**
 * Funnel steps, written by the server on the server's clock. Kept for
 * EVENT_RETENTION_DAYS, matching client_errors.
 *
 * `name` is a plain text column rather than a pgEnum: the closed set lives in
 * shared/events.ts, where adding one is a type error at every call site, and an
 * enum would additionally need a migration this schema module cannot write.
 */
export const events = pgTable("events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
  name: text("name").notNull(),
  context: jsonb("context").notNull().default({}),
}, (t) => [index("events_name_occurred_idx").on(t.name, t.occurredAt)]);

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
  roomId: text("room_id").notNull(),
  finishedAt: timestamp("finished_at").defaultNow().notNull(),
  gameMode: text("game_mode").notNull(),
  // The seated userIds, bots excluded — what a player's own list is read through.
  playerIds: jsonb("player_ids").$type<string[]>().notNull().default([]),
  seats: jsonb("seats").$type<ReplaySeat[]>().notNull().default([]),
  moves: jsonb("moves").$type<ReplayMove[]>().notNull().default([]),
  /** Engine player ids, best first. */
  rankings: jsonb("rankings").$type<string[]>().notNull().default([]),
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
  /**
   * The language this device reads. A push is rendered by the OS with no
   * client in the loop, so it is the only chance the recipient's language has
   * to be consulted.
   */
  locale: text("locale").notNull().default("en"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("push_tokens_user_id_idx").on(t.userId),
]);

/**
 * A proof-of-mailbox-control credential — one shape for both email
 * verification and (next ticket) password reset, per
 * docs/superpowers/specs/2026-09-03-account-recovery-design.md, Box 2.
 *
 * The raw token is a `randomBytes(32)` value handed to the user and never
 * persisted; only its SHA-256 hash is stored, and redemption is the single
 * atomic `UPDATE ... WHERE used_at IS NULL AND expires_at > now()` the design
 * doc specifies, which makes single-use race-proof without a read-then-write.
 * Read by two plain HTTP routes only (verify-email, and the next ticket's
 * reset routes) — never by the socket handshake in server/ticket.ts, which
 * this shape is deliberately not reused from (a reset/verify link survives a
 * server restart; a signed in-memory-nonce ticket does not).
 *
 * Nothing else bounds this table — a row lands per signup and per reset
 * request — so expired rows are swept opportunistically on every redemption
 * rather than kept forever or run through a scheduler.
 */
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    purpose: text("purpose").$type<"email_verify" | "password_reset">().notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    // The only key redemption looks a row up by; unique is what keeps
    // `RETURNING user_id` a single row rather than a set.
    uniqueIndex("auth_tokens_token_hash_uq").on(t.tokenHash),
    index("auth_tokens_user_id_idx").on(t.userId, t.purpose),
  ]
);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/**
 * `@socket.io/postgres-adapter`'s spill table. `pg_notify` caps a payload at
 * 8000 bytes, so anything larger — a sanitized game state is routinely larger —
 * is written here and the notification carries only the row id.
 *
 * Declared here, and created by `server/schemaDdl.ts` like every other table,
 * rather than letting the adapter issue its own `CREATE TABLE`: a second
 * creator is how a table comes to exist on one database and not another.
 * Nothing in this app reads or writes it — the adapter owns the rows, on its
 * own pool, and prunes them on a timer.
 */
export const socketIoAttachments = pgTable(
  "socket_io_attachments",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    payload: bytea("payload").notNull(),
  },
  (t) => [
    // The adapter's own cleanup runs `DELETE ... WHERE created_at < now() - …`
    // on every instance every 30s. Without this it is a sequential scan.
    index("socket_io_attachments_created_at_idx").on(t.createdAt),
  ]
);

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  email: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Room = typeof rooms.$inferSelect;
export type RoomVisibility = (typeof roomVisibilityEnum.enumValues)[number];
export type RoomPlayer = typeof roomPlayers.$inferSelect;
export type Friend = typeof friends.$inferSelect;
export type UserStats = typeof userStats.$inferSelect;
export type MatchHistory = typeof matchHistory.$inferSelect;
export type PushToken = typeof pushTokens.$inferSelect;
export type AuthToken = typeof authTokens.$inferSelect;
export type AuthTokenPurpose = AuthToken["purpose"];
