// Reads of the server's live in-memory table (server/gameRoom.ts) that an
// integration test cannot make through the wire. Test-only, so it lives here
// rather than as an escape hatch inside the server.
import type { Server as SocketServer } from "socket.io";
import { activeGames } from "../../server/gameRoom.ts";
import { clearRoomTimers } from "../../server/gameTimers.ts";
import { broadcastGameState, persistGameState } from "../../server/gamePersistence.ts";
import { armTurn } from "../../server/gameTurn.ts";
import { startReplayLog } from "../../server/replayShape.ts";
import { createDeck, initializeGame } from "../../lib/gameEngine.ts";

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
 * Deals a room's live table a hand somebody has already played.
 *
 * The server shuffles from `crypto` (`lib/gameEngine.ts`'s `shuffleDeck`), so
 * no seed reaches the deal and a hand can only be recovered by handing its
 * cards back in. That is what makes a soak log replayable at all, and it is why
 * this is a write where the rest of this file only reads.
 *
 * Everything downstream of the deal — who opens, on which card — is derived by
 * `initializeGame` rather than restated here, so a replay cannot start from a
 * table the real deal path would never produce. The turn is re-armed because
 * the timer running belongs to the hand this one replaces.
 */
export function redealExactly(io: SocketServer, roomId: string, hands: string[][]): boolean {
  const game = activeGames.get(roomId);
  if (!game) return false;

  const byId = new Map(createDeck().map((card) => [card.id, card]));
  const dealt = hands.map((ids) =>
    ids.map((id) => {
      const card = byId.get(id);
      if (!card) throw new Error(`no such card in the deck: ${id}`);
      return card;
    })
  );
  game.gameState = initializeGame(
    game.gameState.players.map((p) => ({
      name: p.name,
      type: p.type,
      personality: p.personality,
      team: p.team,
    })),
    game.gameState.gameMode,
    0,
    dealt
  );
  // Everything `dealManche` resets, because the hand this replaces is gone: its
  // flags would credit its bombs and jokers to this one, and its `moveLog`
  // would be written to `match_replays` as this hand's replay.
  game.handFlags = {};
  game.moveLog = startReplayLog();
  game.abandonedSeats.clear();

  broadcastGameState(io, game);
  // Postgres still holds the hand this replaces until this lands, and a rejoin
  // that rehydrates from it would be dealt the shuffle nobody is playing.
  persistGameState(roomId, game);
  armTurn(io, roomId);
  return true;
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

/**
 * Rewrites a room's own match target and running scores, so the manche about
 * to be played is guaranteed to end the match without a test having to shape
 * real play toward a particular score. `handleGameOver` only adds this hand's
 * own points on top of what is set here, so one seat set far below the target
 * and the other far above it cannot trade places no matter what the manche
 * itself awards.
 */
export function forceMatchNearTarget(
  roomId: string,
  target: number,
  cumulativeScores: Record<string, number>
): boolean {
  const game = activeGames.get(roomId);
  if (!game) return false;
  game.matchTarget = target;
  game.cumulativeScores = { ...cumulativeScores };
  return true;
}
