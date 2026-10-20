import type { TableRuntime } from "./tableRuntime.ts";
import { logger } from "../shared/logger.ts";
import { rollMatchForward } from "./roundOver.ts";
import { emitMatchState } from "./tableBroadcasts.ts";
import { publishState } from "./gamePersistence.ts";
import { armTurn } from "./gameTurn.ts";
import { clearForDeal } from "./seatLedger.ts";
import type { OnlineGameState } from "./gameRoom.ts";
import type { GameState } from "../../lib/game/gameEngine.ts";

/**
 * What a fresh round resets, and how it reaches the table. Both the first deal
 * of a match (`room:start`) and every deal after it (`game:rematch_vote`) end
 * here, so a reset added for one cannot go missing from the other.
 *
 * `game` must already be in `activeGames`: armTurn and the persistence writers
 * look it up by room id.
 */
export async function dealRound(rt: TableRuntime, game: OnlineGameState, nextState: GameState) {
  game.gameState = nextState;
  // A new round: last round's flags would record the same bombs, jokers and
  // departures again in every remaining round.
  game.roundFlags = {};
  game.moveLog = [];
  clearForDeal(game);
  // Not required for correctness — announceRejoin's `else if` already makes a
  // stale payload unreachable the instant gameState.roundOver goes false, and
  // handleRoundOver clears this itself before the next round it plays can end.
  // Cleared here anyway so the table does not hold a finished round's payload
  // in memory for the whole of the next one.
  game.lastRoundOverPayload = undefined;
  rollMatchForward(game);

  // Not awaited: a join already requires `waiting`, so nothing here depends on
  // the row, and a stalled pool must not hold the deal's broadcast.
  void rt.writers
    .updateRoomStatus(game.roomId, "in_progress")
    .catch((err: unknown) =>
      logger.warn({ err, roomId: game.roomId }, "Failed to set rooms.status = in_progress at the deal")
    );

  void publishState(rt, game);
  rt.out.room(game.roomId).emit("game:started");
  emitMatchState(rt.out.room(game.roomId), game);
  armTurn(rt, game.roomId);
}
