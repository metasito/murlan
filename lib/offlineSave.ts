// The offline game, as it is stored between app launches.
//
// An offline match lives entirely in memory (context/GameContext.tsx), so a
// phone call, a low-memory kill or a swipe-away ends it. Online play survives a
// *server* restart through `active_games`, which left the weaker guarantee on
// the mode played without a network — the one played on a phone.
//
// Pure: encoding, decoding and the decision to trust a stored blob live here so
// they can be tested without AsyncStorage or a renderer. The context does the
// I/O and nothing else.
import type { GameMode, GameState } from "./gameEngine.ts";
import type { MatchState, PlayerSetupConfig, RematchAnswers } from "./matchState.ts";

/**
 * Bumped whenever the stored shape changes. A blob written by an older build is
 * discarded rather than migrated — the same call `server/game/onlineGameLogic.ts`
 * makes for `active_games`, and for the same reason: restoring a hand into a
 * shape the engine no longer expects corrupts a game silently, while losing one
 * abandoned match costs nothing.
 */
export const OFFLINE_SAVE_VERSION = 2;

export { OFFLINE_SAVE_KEY } from "./storageKeys.ts";

export interface OfflineSave {
  version: number;
  gameState: GameState;
  match: MatchState;
  rematchAnswers: RematchAnswers;
  /** Needed to deal the next manche — `initializeRematch` takes the setup, not the state. */
  players: PlayerSetupConfig[];
  gameMode: GameMode;
  /** Where the next manche deals from, so the rotation survives a restart. */
  dealFirstSeat: number;
}

export function encodeOfflineSave(save: Omit<OfflineSave, "version">): string {
  return JSON.stringify({ ...save, version: OFFLINE_SAVE_VERSION });
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export type OfflineDecode =
  | { kind: "none" }
  | { kind: "incompatible" }
  | { kind: "ok"; save: OfflineSave };

const NONE: OfflineDecode = { kind: "none" };
const INCOMPATIBLE: OfflineDecode = { kind: "incompatible" };

/**
 * A stored blob; `incompatible` when a save was there and cannot be trusted,
 * which the player is told about, and `none` when there was never one.
 *
 * Deliberately shallow. The version is what actually protects against a shape
 * change; re-validating every card would be a second copy of the engine's types
 * that could drift from them. What is checked here is that the pieces the
 * restore path immediately dereferences are present and the right kind of
 * thing, so a truncated or hand-edited blob fails here rather than as
 * `Cannot read property 'cards' of null` three screens later.
 */
export function decodeOfflineSave(raw: string | null): OfflineDecode {
  if (!raw) return NONE;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NONE;
  }
  if (!isObject(parsed)) return NONE;
  if (parsed.version !== OFFLINE_SAVE_VERSION) return INCOMPATIBLE;

  const { gameState, match, rematchAnswers, players, gameMode, dealFirstSeat } = parsed;
  if (!isObject(gameState) || !Array.isArray(gameState.players)) return INCOMPATIBLE;
  if (gameState.players.length === 0) return INCOMPATIBLE;
  if (!isObject(match) || !isObject(match.scores) || !Array.isArray(match.hands)) return INCOMPATIBLE;
  if (!isObject(rematchAnswers)) return INCOMPATIBLE;
  if (!Array.isArray(players) || players.length !== gameState.players.length) return INCOMPATIBLE;
  if (gameMode !== "free_for_all" && gameMode !== "teams") return INCOMPATIBLE;
  if (!Number.isInteger(dealFirstSeat)) return INCOMPATIBLE;

  return { kind: "ok", save: parsed as unknown as OfflineSave };
}

/**
 * Whether a decoded save is worth offering to resume.
 *
 * The match being unfinished is the whole rule. A finished *hand* is still
 * resumable — that is the result screen between manches, with the next one
 * still to deal — but a finished match is not: the player saw its final
 * scoreboard and is done, and offering to resume it would lead to a game with
 * nothing left to play.
 */
export function isResumable(save: OfflineSave | null): save is OfflineSave {
  return save !== null && !save.match.over;
}
