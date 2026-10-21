// The stored `active_games.game_state` envelope, shared so `shared/schema.ts` can type the column
// without importing the server.
import { z } from "zod";
import type { GameState } from "../lib/game/gameEngine.ts";
import { gameModeSchema, matchLengthSchema, parseGameState } from "./gameStateSchema.ts";

const isSeat = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/** seat -> userId from the persisted map, dropping any entry that is not one. */
export function readPersistedPlayerMap(storedMap: unknown): Record<number, string> {
  const map: Record<number, string> = {};
  if (storedMap && typeof storedMap === "object" && !Array.isArray(storedMap)) {
    for (const [key, value] of Object.entries(storedMap as Record<string, unknown>)) {
      const seat = Number(key);
      if (isSeat(seat) && typeof value === "string") {
        map[seat] = value;
      }
    }
  }
  return map;
}

/**
 * The vacate bookkeeping, as the stored row carries it: Maps as `[key, value]`
 * pairs, Sets as plain arrays. Its four fields are the live collections of the
 * same names on `OnlineGameState`, and the instance taking a table over reads
 * them from here and nowhere else — they are what make a vacated seat
 * reclaimable, the end-match vote reachable, the walkout an abandonment and the
 * takeover weak for the rest of the round (docs/GAME-RULES.md § Decisions).
 */
export interface PersistedSeats {
  vacatedSeats: [number, { userId: string; username: string }][];
  releasedSeats: string[];
  weakSeats: number[];
  abandonedSeats: [number, string][];
}

/** The pair entries of a stored Map whose values `readValue` accepts. */
function readPersistedPairs<V>(
  stored: unknown,
  readValue: (value: unknown) => V | null
): [number, V][] {
  if (!Array.isArray(stored)) return [];
  const pairs: [number, V][] = [];
  for (const entry of stored) {
    if (!Array.isArray(entry) || entry.length !== 2 || !isSeat(entry[0])) continue;
    const value = readValue(entry[1]);
    if (value !== null) pairs.push([entry[0], value]);
  }
  return pairs;
}

/**
 * The vacate bookkeeping from a stored row, filtered entry by entry the way
 * `readPersistedPlayerMap` is: an absent block reads back as four empty
 * collections, which is how a row written without one restores, and a
 * malformed one never throws.
 */
function readPersistedSeats(stored: unknown): PersistedSeats {
  const block = stored && typeof stored === "object" && !Array.isArray(stored)
    ? (stored as Record<string, unknown>)
    : {};
  return {
    vacatedSeats: readPersistedPairs(block.vacatedSeats, (value) =>
      value && typeof value === "object" &&
      typeof (value as { userId?: unknown }).userId === "string" &&
      typeof (value as { username?: unknown }).username === "string"
        ? (value as { userId: string; username: string })
        : null
    ),
    releasedSeats: Array.isArray(block.releasedSeats)
      ? block.releasedSeats.filter((id): id is string => typeof id === "string")
      : [],
    weakSeats: Array.isArray(block.weakSeats) ? block.weakSeats.filter(isSeat) : [],
    abandonedSeats: readPersistedPairs(block.abandonedSeats, (value) =>
      typeof value === "string" ? value : null
    ),
  };
}

/**
 * Bumped whenever the persisted shape of a game changes, or how strictly it is
 * read. A row older than `OLDEST_GAME_SCHEMA_VERSION` can hold hands that no
 * longer match the current rules — rehydrating it deals a silently corrupt game
 * instead of crashing, so it is rejected, not restored. Rows from
 * `OLDEST_GAME_SCHEMA_VERSION` on are restored, each held to the current parse.
 * Held to the stored shape by tests/server/storedShapeVersions.test.ts.
 */
export const GAME_SCHEMA_VERSION = 7;

/**
 * The oldest row still restored. Raise it to GAME_SCHEMA_VERSION when a bump changes what a
 * row holds and `parseGameState` keeps no reading of the older shape; leave it when the bump only
 * tightens the parse, which still holds every row to it.
 */
export const OLDEST_GAME_SCHEMA_VERSION = 5;

/** The first version that stores `openingCard`; an older row is read as `openingFlags`. */
const OPENING_CARD_SCHEMA_VERSION = 7;

export type RoundFlags = Record<number, { bomb: boolean; joker: boolean }>;

/**
 * The match bookkeeping that outlives the round on the table, declared once:
 * this schema is what a stored row is parsed with on restore, and
 * `PersistedMatch` is the shape the write side is held to. A new field is
 * added here and nowhere else.
 */
export const persistedMatchSchema = z.object({
  playerMap: z.unknown().transform(readPersistedPlayerMap),
  scores: z.record(
    z
      .number({
        required_error: "scores are missing",
        invalid_type_error: "scores are not all numbers",
      })
      .finite("scores are not all numbers"),
    { required_error: "scores are not all numbers", invalid_type_error: "scores are not all numbers" },
  ),
  gameMode: z.enum(gameModeSchema.options, {
    errorMap: (_iss, ctx) => ({ message: `game mode ${String(ctx.data)}` }),
  }),
  matchLength: z.enum(matchLengthSchema.options, {
    errorMap: (_iss, ctx) => ({ message: `match length ${String(ctx.data)}` }),
  }),
  matchTarget: z
    .number({ required_error: "match target missing", invalid_type_error: "match target missing" })
    .int("match target missing")
    .min(1, "match target missing"),
  maxPlayers: z
    .number({ required_error: "max players missing", invalid_type_error: "max players missing" })
    .int("max players missing")
    .min(1, "max players missing"),
  // Defaulted rather than required: a row written before the field existed
  // restores as a match with no rounds behind it, which costs the results
  // board one number and never the round.
  roundsPlayed: z.number().int().min(0).catch(0).default(0),
  endedByVote: z.boolean().catch(false).default(false),
  matchOver: z.boolean({
    required_error: "match verdict missing",
    invalid_type_error: "match verdict missing",
  }),
}, { required_error: "no match state", invalid_type_error: "no match state" });

export type PersistedMatch = z.infer<typeof persistedMatchSchema>;

/**
 * The stored `game_state` blob: everything about a live table except the room
 * id that keys it and the `updated_at` the sweep filters on.
 *
 * One versioned document rather than a column each, so a `GAME_SCHEMA_VERSION`
 * bump refuses a stale row whole — and adding a field costs no `db:push`.
 *
 * `gameState` is nested, not spread: `GameState` has its own `gameMode`, which
 * a flat envelope would have the match's overwrite.
 */
export interface PersistedEnvelope {
  schemaVersion: number;
  gameState: GameState;
  roundFlags: RoundFlags;
  dealFirstSeat: number;
  /**
   * The room's six-character join code. Stored here as well as in `rooms.code`
   * because a cold-start rejoin has to be able to draw the room screen when
   * that row is gone, and a code cannot be invented — an unjoinable one on
   * screen is worse than none.
   */
  joinCode: string;
  match: PersistedMatch;
  seats: PersistedSeats;
}

export function packPersistedState(
  gameState: GameState,
  roundFlags: RoundFlags,
  dealFirstSeat: number,
  joinCode: string,
  match: PersistedMatch,
  seats: PersistedSeats
): PersistedEnvelope {
  return { schemaVersion: GAME_SCHEMA_VERSION, gameState, roundFlags, dealFirstSeat, joinCode, match, seats };
}

export type PersistedRestore =
  | ({ ok: true } & Omit<PersistedEnvelope, "schemaVersion">)
  | { ok: false; reason: string; newer?: true };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const roundFlag = z.boolean({
  required_error: "round flags are not all booleans",
  invalid_type_error: "round flags are not all booleans",
});

/**
 * The envelope a stored row must parse into. Declared here and nowhere else:
 * `packPersistedState` writes this shape (a parity test pins its keys to the
 * schema's), `unpackPersistedState` refuses anything that does not satisfy it.
 */
export const persistedEnvelopeSchema = z.object({
  // Held to `parseGameState` once the rest of the envelope has parsed.
  gameState: z.unknown(),
  roundFlags: z.record(z.object({ bomb: roundFlag, joker: roundFlag }, { invalid_type_error: "no round flags" }), {
    required_error: "no round flags",
    invalid_type_error: "no round flags",
  }),
  dealFirstSeat: z
    .number({ required_error: "no deal rotation", invalid_type_error: "no deal rotation" })
    .int("no deal rotation")
    .nonnegative("no deal rotation"),
  joinCode: z
    .string({ required_error: "no join code", invalid_type_error: "no join code" })
    .min(1, "no join code"),
  match: persistedMatchSchema,
  // Read through a filter rather than declared required, so a row without the
  // block restores with four empty collections. Refusing it instead would
  // dispose every live table that lacks it.
  seats: z.unknown().transform(readPersistedSeats),
});

/**
 * Reads a stored blob back, or says why it cannot be. The version stamp is
 * checked before the parse — it answers "may this row be restored at all",
 * which a field schema cannot — and the schema's first complaint becomes the
 * reason; `gameState`'s is `parseGameState`'s. `match.playerMap` and `seats`
 * are filtered entry by entry rather than refused: a wholly malformed map
 * reads back as an empty one, which the caller's seat check turns into
 * UNAUTHORIZED.
 */
export function unpackPersistedState(persisted: unknown): PersistedRestore {
  if (!isPlainObject(persisted)) return { ok: false, reason: "not an object" };
  const version = persisted.schemaVersion;
  if (typeof version === "number" && version > GAME_SCHEMA_VERSION) {
    return { ok: false, newer: true, reason: `schema version ${version} is newer` };
  }
  if (typeof version !== "number" || version < OLDEST_GAME_SCHEMA_VERSION) {
    return { ok: false, reason: `schema version ${String(persisted.schemaVersion)}` };
  }
  const parsed = persistedEnvelopeSchema.safeParse(persisted);
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues[0]?.message ?? "malformed envelope" };
  }
  const gameState = parseGameState(
    parsed.data.gameState,
    version < OPENING_CARD_SCHEMA_VERSION ? "openingFlags" : "current"
  );
  if (!gameState.ok) return { ok: false, reason: gameState.reason };
  return { ok: true, ...parsed.data, gameState: gameState.state };
}
