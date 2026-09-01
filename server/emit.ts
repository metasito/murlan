import type { Server as SocketServer } from "socket.io";
import type { OnlineGameState } from "./gameRoom.ts";
import { scoresByEngineId } from "./gameOver.ts";

/** The framing of the manche now running: what it is worth and where it stands. */
export function emitMatchState(io: SocketServer, room: string, game: OnlineGameState) {
  io.to(room).emit("game:match_state", {
    target: game.matchTarget,
    length: game.matchLength,
    handsPlayed: game.handsPlayed,
    scores: scoresByEngineId(game),
  });
}

/**
 * Who has said yes to another manche, out of how many can answer.
 *
 * `total` is the seated-seat count, which is what every gate on this vote
 * compares against: a bot, and a seat whose player left, hold no vote.
 */
export function emitVoteState(io: SocketServer, room: string, game: OnlineGameState) {
  io.to(room).emit("game:vote_state", {
    votes: Array.from(game.rematchVotes),
    total: Object.keys(game.playerMap).length,
  });
}
