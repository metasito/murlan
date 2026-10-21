// The offline match, as it is stored between app launches.
//
// An offline match lives entirely in memory (context/GameContext.tsx), so a
// phone call, a low-memory kill or a swipe-away ends it. Online play survives a
// *server* restart through `active_games`, which left the weaker guarantee on
// the mode played without a network — the one played on a phone.
//
// Pure: encoding, decoding and the decision to trust a stored blob live here so
// they can be tested without AsyncStorage or a renderer. The context does the
// I/O and nothing else.
import { z } from "zod";
import type { GameState } from "./game/gameEngine.ts";
import type { MatchState } from "./game/matchState.ts";
import { matchLengthSchema, parseGameState, type Same } from "../shared/gameStateSchema.ts";

/**
 * Bumped whenever the stored shape changes, or how strictly it is read. A blob
 * older than `OLDEST_OFFLINE_SAVE_VERSION` is discarded rather than migrated.
 * Held to the stored shape by tests/server/storedShapeVersions.test.ts.
 */
export const OFFLINE_SAVE_VERSION = 7;

/** The oldest save still resumed, on `OLDEST_GAME_SCHEMA_VERSION`'s policy (shared/persistedEnvelope.ts). */
export const OLDEST_OFFLINE_SAVE_VERSION = 5;

/** The first version that stores `openingCard`; an older save is read as `openingFlags`. */
const OPENING_CARD_SAVE_VERSION = 7;

export { OFFLINE_SAVE_KEY } from "./storageKeys.ts";

export interface OfflineSave {
  version: number;
  gameState: GameState;
  match: MatchState;
  /** Where the next round deals from, so the rotation survives a restart. */
  dealFirstSeat: number;
}

export function encodeOfflineSave(save: Omit<OfflineSave, "version">): string {
  return JSON.stringify({ ...save, version: OFFLINE_SAVE_VERSION });
}

const points = z.record(z.number().finite());

const matchSchema = z.object({
  length: matchLengthSchema,
  target: z.number().int().min(1),
  over: z.boolean(),
  winners: z.array(z.string()),
  isDraw: z.boolean(),
  scores: points,
  rounds: z.array(z.object({ finishingOrder: z.array(z.string()), pointsAwarded: points })),
});

const declaresMatchState: Same<z.infer<typeof matchSchema>, MatchState> = true;
void declaresMatchState;

export type OfflineDecode =
  | { kind: "none" }
  | { kind: "incompatible" }
  | { kind: "ok"; save: OfflineSave };

const NONE: OfflineDecode = { kind: "none" };
const INCOMPATIBLE: OfflineDecode = { kind: "incompatible" };

/**
 * A stored blob; `incompatible` when a save was there and cannot be trusted,
 * which the player is told about, and `none` when there was never one. The
 * engine state is held to `parseGameState`, the same document `active_games`
 * restores through.
 */
export function decodeOfflineSave(raw: string | null): OfflineDecode {
  if (!raw) return NONE;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NONE;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return NONE;
  const { version, gameState, match, dealFirstSeat } = parsed as Record<string, unknown>;
  if (typeof version !== "number" || version < OLDEST_OFFLINE_SAVE_VERSION || version > OFFLINE_SAVE_VERSION) {
    return INCOMPATIBLE;
  }

  const state = parseGameState(gameState, version < OPENING_CARD_SAVE_VERSION ? "openingFlags" : "current");
  const verdict = matchSchema.safeParse(match);
  if (!state.ok || !verdict.success) return INCOMPATIBLE;
  if (typeof dealFirstSeat !== "number" || !Number.isInteger(dealFirstSeat)) return INCOMPATIBLE;

  return { kind: "ok", save: { version, gameState: state.state, match: verdict.data, dealFirstSeat } };
}

/**
 * Whether a decoded save is worth offering to resume.
 *
 * The match being unfinished is the whole rule. A finished *round* is still
 * resumable — that is the table's ending between rounds, with the next one
 * still to deal — but a finished match is not: the player saw its final
 * scoreboard and is done, and offering to resume it would lead to a match with
 * nothing left to play.
 */
export function isResumable(save: OfflineSave | null): save is OfflineSave {
  return save !== null && !save.match.over;
}
