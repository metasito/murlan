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
import type {
  MatchState,
  PlayerSetupConfig,
  RematchAnswers,
} from "../context/GameContext.tsx";

/**
 * Bumped whenever the stored shape changes. A blob written by an older build is
 * discarded rather than migrated — the same call `server/onlineGameLogic.ts`
 * makes for `active_games`, and for the same reason: restoring a hand into a
 * shape the engine no longer expects corrupts a game silently, while losing one
 * abandoned match costs nothing.
 */
export const OFFLINE_SAVE_VERSION = 2;

export const OFFLINE_SAVE_KEY = "@murlan_offline_game";

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

/**
 * A stored blob, or null if there is any doubt at all.
 *
 * Deliberately shallow. The version is what actually protects against a shape
 * change; re-validating every card would be a second copy of the engine's types
 * that could drift from them. What is checked here is that the pieces the
 * restore path immediately dereferences are present and the right kind of
 * thing, so a truncated or hand-edited blob fails here rather than as
 * `Cannot read property 'cards' of null` three screens later.
 */
export function decodeOfflineSave(raw: string | null): OfflineSave | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(parsed)) return null;
  if (parsed.version !== OFFLINE_SAVE_VERSION) return null;

  const { gameState, match, rematchAnswers, players, gameMode, dealFirstSeat } = parsed;
  if (!isObject(gameState) || !Array.isArray(gameState.players)) return null;
  if (gameState.players.length === 0) return null;
  if (!isObject(match) || !isObject(match.scores) || !Array.isArray(match.hands)) return null;
  if (!isObject(rematchAnswers)) return null;
  if (!Array.isArray(players) || players.length !== gameState.players.length) return null;
  if (gameMode !== "free_for_all" && gameMode !== "teams") return null;
  if (!Number.isInteger(dealFirstSeat)) return null;

  return parsed as unknown as OfflineSave;
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
