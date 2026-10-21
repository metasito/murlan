// Reads of the server's live in-memory table (server/game/gameRoom.ts) that an
// integration test cannot make through the wire. Test-only, so it lives here
// rather than as an escape hatch inside the server.
import type { TableRuntime } from "../../server/game/tableRuntime.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import { clearRoomTimers } from "../../server/game/gameTimers.ts";
import { publishState } from "../../server/game/gamePersistence.ts";
import { armTurn } from "../../server/game/gameTurn.ts";
import { applied } from "../../server/game/tableRouter.ts";
import { clearForDeal } from "../../server/game/seatLedger.ts";
import { createDeck, seatsOf, startRound, type Opening } from "../../lib/game/gameEngine.ts";

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
 * Everything a process restart loses under one table: the game and its timers,
 * as `forgetActiveGame`, and the record of intents already answered, which a
 * restart takes from every table at once. Without the second, a duplicate
 * re-sent across the "restart" is answered from a record no restarted
 * process would still hold.
 */
export function restartUnder(roomId: string): boolean {
  applied.clear();
  return forgetActiveGame(roomId);
}

/**
 * Deals a room's live table a round somebody has already played, or one that
 * opens on `opening` — an exchange, with no round played out to reach it.
 *
 * The server shuffles from `crypto` and takes no seed, so a
 * round can only be recovered by handing its cards back in. That is what makes
 * a soak log replayable at all, and it is why this is a write where the rest of
 * this file only reads.
 *
 * Everything downstream of the deal — who opens, on which card — is derived by
 * `startRound` rather than restated here, so a replay cannot start from a
 * table the real deal path would never produce. The turn is re-armed because
 * the timer running belongs to the round this one replaces.
 */
export function redealExactly(
  rt: TableRuntime,
  roomId: string,
  hands: string[][],
  { opening }: { opening?: Opening } = {}
): boolean {
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
  game.gameState = startRound(seatsOf(game.gameState), game.gameState.gameMode, { dealt, opening });
  // Everything `dealRound` resets, because the round this replaces is gone: its
  // flags would credit its bombs and jokers to this one, and its `moveLog`
  // would be written to `round_replays` as this round's replay.
  game.roundFlags = {};
  game.moveLog = [];
  clearForDeal(game);

  // The persist matters: Postgres still holds the round this replaces until it
  // lands, and a rejoin that rehydrates from it would be dealt the shuffle
  // nobody is playing.
  void publishState(rt, game);
  armTurn(rt, roomId);
  return true;
}

/**
 * A snapshot of the seat -> userId map a room's live game is routing hands
 * by. It is the only thing that decides whose cards a viewer is sent, and
 * which seats the turn arbiter drives with the bot, so a test asserting that a
 * seat did not move under a player has to read it directly.
 */
export function seatedUsers(roomId: string): Record<number, string> | null {
  const game = activeGames.get(roomId);
  return game ? { ...game.playerMap } : null;
}

/**
 * The match bookkeeping of a room's live game: the format, the target, the
 * running scores and the identity of the round on the table. A second deal
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
    finishingOrder: [...game.gameState.finishingOrder],
    dealFirstSeat: game.dealFirstSeat,
  };
}

/**
 * Rewrites a room's own match target and running scores, so the round about
 * to be played is guaranteed to end the match without a test having to shape
 * real play toward a particular score. `handleRoundOver` only adds this round's
 * own points on top of what is set here, so one seat set far below the target
 * and the other far above it cannot trade places no matter what the round
 * itself awards.
 */
export function forceMatchNearTarget(
  roomId: string,
  target: number,
  cumulativeScores: Record<string, number>
): boolean {
  const game = activeGames.get(roomId);
  if (!game) return false;
  Object.assign(game, { matchTarget: target, cumulativeScores: { ...cumulativeScores } });
  return true;
}
