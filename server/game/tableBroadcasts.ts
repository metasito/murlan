import type { Emitter } from "./tableRuntime.ts";
import { voterCount, voteStateOf, type OnlineGameState } from "./gameRoom.ts";
import { scoresByEngineId } from "./roundOver.ts";

/** The framing of the round now running: what it is worth and where it stands. */
export function emitMatchState(to: Emitter, game: OnlineGameState) {
  to.emit("game:match_state", {
    target: game.matchTarget,
    length: game.matchLength,
    roundsPlayed: game.roundsPlayed,
    scores: scoresByEngineId(game),
  });
}

/**
 * Who has said yes to another round, out of how many can answer.
 *
 * `total` is the seated-seat count, which is what every gate on this vote
 * compares against: a bot, and a seat whose player left, hold no vote.
 */
export function emitVoteState(to: Emitter, game: OnlineGameState) {
  to.emit("game:vote_state", voteStateOf(game));
}

/**
 * Who has voted to end the match outright, out of how many can answer — the
 * same unanimity-among-seated-humans shape as `emitVoteState`, kept apart
 * because it answers a different question (docs/GAME-RULES.md § Decisions).
 */
export function emitEndMatchVoteState(to: Emitter, game: OnlineGameState) {
  to.emit("game:end_match_vote_state", {
    votes: Array.from(game.endMatchVotes),
    total: voterCount(game),
  });
}
