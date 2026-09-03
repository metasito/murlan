import type { Server as SocketServer } from "socket.io";
import { storage } from "./storage.ts";
import { rollMatchForward } from "./gameOver.ts";
import { emitMatchState } from "./emit.ts";
import { broadcastGameState, persistGameState } from "./gamePersistence.ts";
import { armTurn } from "./gameTurn.ts";
import { startReplayLog } from "./replayShape.ts";
import type { OnlineGameState } from "./gameRoom.ts";
import type { GameState } from "../lib/gameEngine.ts";

/**
 * What a fresh manche resets, and how it reaches the table. Both the first deal
 * of a match (`room:start`) and every deal after it (`game:rematch_vote`) end
 * here, so a reset added for one cannot go missing from the other.
 *
 * `game` must already be in `activeGames`: armTurn and the persistence writers
 * look it up by room id.
 */
export async function dealManche(
  io: SocketServer,
  game: OnlineGameState,
  nextState: GameState
) {
  game.gameState = nextState;
  // A new hand: last hand's flags would record the same bombs, jokers and
  // departures again in every remaining manche.
  game.handFlags = {};
  game.moveLog = startReplayLog();
  game.abandonedSeats.clear();
  // Minimum-legal play (docs/BRIEF.md §3.1) is scoped to the hand a seat was
  // taken over mid-play; a fresh deal always starts full AI. The end-match
  // vote is answered against the table as it stands now, not a stalled tally
  // from the hand that just ended.
  game.weakSeats.clear();
  game.endMatchVotes.clear();
  // Not required for correctness — announceRejoin's `else if` already makes a
  // stale payload unreachable the instant gameState.gameOver goes false, and
  // handleGameOver clears this itself before the next hand it plays can end.
  // Cleared here anyway so the table does not hold a finished hand's payload
  // in memory for the whole of the next one.
  game.lastGameOverPayload = undefined;
  rollMatchForward(game);

  await storage.updateRoomStatus(game.roomId, "in_progress");

  broadcastGameState(io, game);
  io.to(game.roomId).emit("game:started");
  emitMatchState(io, game.roomId, game);

  persistGameState(game.roomId, game);
  armTurn(io, game.roomId);
}
