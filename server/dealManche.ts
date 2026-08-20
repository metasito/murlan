import type { Server as SocketServer } from "socket.io";
import { storage } from "./storage.ts";
import { rollMatchForward, scoresByName } from "./gameOver.ts";
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
  rollMatchForward(game);

  await storage.updateRoomStatus(game.roomId, "in_progress");

  broadcastGameState(io, game);
  io.to(game.roomId).emit("game:started");
  io.to(game.roomId).emit("game:match_state", {
    target: game.matchTarget,
    length: game.matchLength,
    scores: scoresByName(game),
  });

  persistGameState(game.roomId, game);
  armTurn(io, game.roomId);
}
