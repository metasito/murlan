// Reads of the server's live in-memory table (server/gameRoom.ts) that an
// integration test cannot make through the wire. Test-only, so it lives here
// rather than as an escape hatch inside the server.
import { activeGames } from "../../server/gameRoom.ts";
import { clearRoomTimers } from "../../server/gameTimers.ts";

/**
 * Whether a room still holds a live in-memory game. The only observable
 * difference between a disposed table and one that merely stopped emitting,
 * since disposal deletes the `active_games` row without awaiting it.
 */
export function hasActiveGame(roomId: string): boolean {
  return activeGames.has(roomId);
}

/**
 * Drops a room's live game and its timers while leaving the `active_games`
 * row alone — exactly what a process restart leaves behind, and the only way
 * a test can reach `game:rejoin`'s rehydration branch.
 */
export function forgetActiveGame(roomId: string): boolean {
  clearRoomTimers(roomId);
  return activeGames.delete(roomId);
}

/**
 * A snapshot of the seat -> userId map a room's live game is routing hands
 * by. It is the only thing that decides whose cards a viewer is sent, and
 * which seats the turn arbiter drives with the AI, so a test asserting that a
 * seat did not move under a player has to read it directly.
 */
export function seatedUsers(roomId: string): Record<number, string> | null {
  const game = activeGames.get(roomId);
  return game ? { ...game.playerMap } : null;
}

/**
 * The match bookkeeping of a room's live game: the format, the target, the
 * running scores and the identity of the hand on the table. A second deal
 * path is only observable through these — the clients see an ordinary
 * `game:started` either way.
 */
export function matchSnapshot(roomId: string) {
  const game = activeGames.get(roomId);
  if (!game) return null;
  return {
    matchLength: game.matchLength,
    matchTarget: game.matchTarget,
    matchOver: game.matchOver,
    cumulativeScores: { ...game.cumulativeScores },
    rankings: [...game.gameState.rankings],
    dealFirstSeat: game.dealFirstSeat,
  };
}
