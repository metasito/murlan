import type { Server as SocketServer } from "socket.io";
import { logger } from "./logger.ts";
import { clearRoomTimers, clearRoomDisconnectTimers } from "./gameTimers.ts";
import type { OnlineGameState } from "./gameRoom.ts";
import { resolveHandEnd, seatTotal } from "./onlineGameLogic.ts";
import { replaySeatsOf } from "./replayShape.ts";
import { isMajority, tallyRematchAnswers, firstTargetFor } from "../lib/gameEngine.ts";
import type { GameOverPayload } from "../lib/matchState.ts";
import type { GameMode } from "../lib/gameEngine.ts";
import type { GameResult } from "../lib/achievements.ts";
import type { ReplayMove, ReplaySeat } from "../lib/replay.ts";

/**
 * The database writes a finished hand performs, taken as an argument rather
 * than imported: importing them would put storage, stats, ratings and replays
 * behind this module, and the point of splitting it out is that the function
 * deciding who won a match can be run against a hand-built game and a stub io.
 * server/gamePersistence.ts holds the production set.
 */
export interface GameOverWriters {
  updateRoomStatus: (
    roomId: string,
    status: "waiting" | "in_progress" | "finished"
  ) => Promise<void>;
  persistGameState: (roomId: string, game: OnlineGameState) => Promise<unknown>;
  recordGameResult: (
    results: GameResult[],
    gameMode: GameMode,
    finishedAt: Date,
    ratingDeltas?: Map<string, number>
  ) => Promise<void>;
  /**
   * What the hand is about to do to each seat's rating. Read before
   * `game:over` goes out, because the inputs stop existing once the rated
   * write lands — see server/ratings.ts.
   */
  previewRatedDeltas: (
    seatResults: { userId: string; placement: number }[],
    gameMode: string,
    finishedAt: Date
  ) => Promise<Map<string, number>>;
  recordRatedResult: (
    seatResults: { userId: string; placement: number }[],
    gameMode: string,
    finishedAt: Date
  ) => Promise<void>;
  saveReplay: (input: {
    roomId: string;
    finishedAt: Date;
    gameMode: GameMode;
    seats: ReplaySeat[];
    moves: ReplayMove[];
    rankings: string[];
  }) => Promise<void>;
}

export async function handleGameOver(
  io: SocketServer,
  roomId: string,
  game: OnlineGameState,
  writers: GameOverWriters
) {
  // Cleared here, synchronously, before anything below can await: the caller
  // already flipped `state.gameOver` true in this same tick, so a rejoin
  // reading `game.lastGameOverPayload` must never be able to observe that
  // flag alongside the previous hand's payload. The real assignment below
  // runs after a DB round trip; nothing between here and there may add one.
  game.lastGameOverPayload = undefined;
  const state = game.gameState;
  clearRoomTimers(roomId);
  // A pending grace timer must not fire into a finished game and evict the
  // survivors from the rematch screen.
  clearRoomDisconnectTimers(game);

  const result = resolveHandEnd({
    state,
    playerMap: game.playerMap,
    cumulativeScores: game.cumulativeScores,
    matchTarget: game.matchTarget,
    matchLength: game.matchLength,
    gameMode: game.gameMode,
    handFlags: game.handFlags,
    abandonedSeats: game.abandonedSeats,
    botSeatsAtStart: game.botSeatsAtStart,
    vacatedSeats: game.vacatedSeats,
  });
  const { handByKey, matchWinners, isDraw, detailed, winnerEngineIds } = result;
  game.cumulativeScores = result.cumulativeScores;
  game.matchTarget = result.matchTarget;
  game.matchOver = result.matchOver;
  game.handsPlayed += 1;

  const matchContinues = game.matchOver ? tableWantsRematch(game) : false;

  game.rematchVotes = new Set();

  // One clock for the preview, the emit and the rated write below: two calls
  // to `new Date()` can straddle a month boundary, and the season key is
  // derived from it — the delta shown would then belong to a different season
  // from the one written.
  const finishedAt = new Date();
  // Awaited, unlike the writes below, and deliberately: this is a read, and
  // it is the only moment the delta exists. `user_ratings` keeps only the
  // current rating, so once the rated write lands nothing can reconstruct what
  // the hand changed. A failure here costs the panel its number, never the
  // hand — hence the empty map rather than a throw.
  const ratingDeltasByUser = result.recordable
    ? await writers
        .previewRatedDeltas(result.gameResults, game.gameMode, finishedAt)
        .catch((err) => {
          logger.warn({ err, roomId }, "Could not read the hand's rating deltas");
          return new Map<string, number>();
        })
    : new Map<string, number>();

  const over: GameOverPayload = {
    rankings: state.rankings,
    scores: detailed,
    matchTarget: game.matchTarget,
    matchLength: game.matchLength,
    handsPlayed: game.handsPlayed,
    matchOver: game.matchOver,
    matchWinnerIds: winnerEngineIds,
    matchContinues,
    isDraw,
    // Keyed by user id, and absent for a table that earns no rating — an
    // offline or teams hand, or one without two rated finishers. The client
    // shows its empty state on absence rather than on a zero, which is a real
    // outcome.
    ratingDeltas: Object.fromEntries(ratingDeltasByUser),
    recorded: result.recordable,
    voided: false,
  };
  io.to(roomId).emit("game:over", over);
  // Kept so `announceRejoin` can hand this hand's scores to a client that
  // rejoins after everyone still in the room has already been sent them.
  game.lastGameOverPayload = over;

  // The one record of how a hand resolved. `match_replays` is not a substitute:
  // it is written only for a table with a human seat and a live moveLog, and it
  // stores no scores. Ids and integers only — never hand contents.
  logger.info(
    {
      roomId,
      gameMode: game.gameMode,
      matchLength: game.matchLength,
      rankings: state.rankings,
      handByKey,
      cumulative: game.cumulativeScores,
      matchTarget: game.matchTarget,
      matchOver: game.matchOver,
      isDraw,
      matchWinners,
    },
    "Hand over"
  );

  await writers
    .updateRoomStatus(roomId, "finished")
    .catch((err) =>
      logger.warn(
        { err, roomId },
        "Failed to set rooms.status = finished after the hand ended"
      )
    );
  // The row is kept (not deleted) so a restart between hands restores the
  // running match instead of silently resetting the scoreboard. Awaited so a
  // caller that disposes the table straight after cannot delete the row
  // before this write lands on it.
  await writers.persistGameState(roomId, game);

  // ── Stats / history / achievements ────────────────────────────────────────
  //
  // Deliberately placed after every broadcast/persist above, not before: the
  // game-over guarantee is "a stats write must never block or fail the
  // game", and handleGameOver is itself async with two call sites that
  // invoke it as bare `void` (runBotTurn and handleAutoPass). The
  // shaping itself already happened, purely, in resolveHandEnd — this block
  // is only the (fire-and-forget) writes, still guarded so a throw here
  // cannot reject handleGameOver's own promise.
  try {
    const { gameResults, recordable } = result;
    if (!recordable) {
      logger.info(
        { roomId },
        "Bot-majority table — stats, history and achievements not recorded"
      );
    } else {
      // Deliberately not awaited: a stats write must never be able to block
      // or delay whatever runs after handleGameOver at any of its call sites.
      writers.recordGameResult(gameResults, game.gameMode, finishedAt, ratingDeltasByUser).catch((err) =>
        logger.error({ err, roomId }, "Failed to record game results")
      );
      // The ladder moves on the same gate as stats: a bot-majority table
      // awards nothing, or a private room of bots would be free rating.
      // recordRatedResult declines a teams result on its own (placement
      // belongs to the pair, not to either partner).
      writers.recordRatedResult(gameResults, game.gameMode, finishedAt).catch((err) =>
        logger.error({ err, roomId }, "Failed to record rated result")
      );
    }

    // On the same `recordable` gate as the stats above: a replay is reached
    // through its `match_history` row, so one written without a row is
    // openable from nowhere.
    //
    // Not awaited, and the table is not required to exist: until `db:push` has
    // run the insert fails, is logged, and the only consequence is an empty
    // replays list.
    if (recordable && game.moveLog && game.moveLog.length > 0) {
      writers.saveReplay({
        roomId,
        finishedAt,
        gameMode: game.gameMode,
        seats: replaySeatsOf(state.players, game.playerMap),
        moves: game.moveLog,
        rankings: state.rankings,
      }).catch((err) => logger.error({ err, roomId }, "Failed to save replay"));
    }
  } catch (err) {
    // Belt-and-braces: even the synchronous work above must not be able to
    // throw back into handleGameOver's own promise (see the comment above
    // this block).
    logger.error({ err, roomId }, "Failed to schedule stats/ratings/replay writes");
  }
}

/**
 * Ends the match without scoring whatever hand was in progress: nothing is
 * folded into `cumulativeScores`, `handsPlayed` does not advance, and no
 * stats/rating/replay write runs — the whole point being that this hand
 * never happened. `game:over` still goes out, so the table's clients leave
 * the game screen the one way they know how, rather than being torn down.
 */
async function closeMatchWithoutScoring(
  io: SocketServer,
  roomId: string,
  game: OnlineGameState,
  writers: GameOverWriters,
  voided: boolean
): Promise<void> {
  game.lastGameOverPayload = undefined;
  clearRoomTimers(roomId);
  clearRoomDisconnectTimers(game);
  game.gameState.gameOver = true;
  game.matchOver = true;

  const over: GameOverPayload = {
    rankings: [],
    scores: [],
    matchTarget: game.matchTarget,
    matchLength: game.matchLength,
    handsPlayed: game.handsPlayed,
    matchOver: true,
    matchWinnerIds: [],
    matchContinues: false,
    isDraw: false,
    ratingDeltas: {},
    recorded: false,
    voided,
  };
  io.to(roomId).emit("game:over", over);
  game.lastGameOverPayload = over;

  await writers
    .updateRoomStatus(roomId, "finished")
    .catch((err) =>
      logger.warn(
        { err, roomId },
        "Failed to set rooms.status = finished after the match closed with no further scoring"
      )
    );
  await writers.persistGameState(roomId, game);
}

/**
 * A match abandoned before its first point (docs/BRIEF.md §3.1): nothing
 * earned, nothing taken, rated for nobody — not even the seat that walked
 * out. The caller disposes the table; there is nobody left to show a
 * results screen to.
 */
export async function voidAbandonedMatch(
  io: SocketServer,
  roomId: string,
  game: OnlineGameState,
  writers: GameOverWriters
): Promise<void> {
  await closeMatchWithoutScoring(io, roomId, game, writers, true);
}

/**
 * The table's own unanimous vote to end a match a seat has been vacated
 * from (docs/BRIEF.md §3.1) — penalty-free for everyone still present. Every
 * hand already finished stays exactly as recorded; only the one in progress,
 * if any, goes unscored. The table is left in place, at the results screen,
 * rather than disposed: the players who agreed to stop are still here.
 */
export async function endMatchByAgreement(
  io: SocketServer,
  roomId: string,
  game: OnlineGameState,
  writers: GameOverWriters
): Promise<void> {
  await closeMatchWithoutScoring(io, roomId, game, writers, false);
}

/** Between hands: a finished match starts over, an unfinished one carries on. */
export function rollMatchForward(game: OnlineGameState) {
  if (game.matchOver) {
    const target = firstTargetFor(game.gameState.players.length);
    game.cumulativeScores = {};
    game.matchTarget = target;
    game.handsPlayed = 0;
    game.matchOver = false;
    game.rematchIntents.clear();
  }
}

/**
 * How many seats want another match, and how many seats there are. A seat
 * with no playerMap entry — a bot, or a human's seat after they left — has
 * no one who can answer, so it abstains: it counts toward neither yes nor
 * total. A seated human who never answered counts as a no, but still counts
 * toward total.
 */
export function countRematchAnswers(game: OnlineGameState): { yes: number; total: number } {
  return tallyRematchAnswers(game.gameState.players.length, (seat) => {
    const userId = game.playerMap[seat];
    if (userId === undefined) return "abstain";
    return game.rematchIntents.get(userId) === true;
  });
}

/**
 * Cumulative match points keyed by engine player id — the identity `rankings`,
 * the match winners and the `game:over` scoreboard are all stated in. Keying
 * it by display name collapsed two seats sharing one, silently.
 */
export function scoresByEngineId(game: OnlineGameState): Record<string, number> {
  const byId: Record<string, number> = {};
  game.gameState.players.forEach((p, seat) => {
    byId[p.id] = seatTotal(game.cumulativeScores, game.playerMap, game.vacatedSeats, seat);
  });
  return byId;
}

export function tableWantsRematch(game: OnlineGameState): boolean {
  const { yes, total } = countRematchAnswers(game);
  return isMajority(yes, total);
}

export function broadcastRematchIntents(io: SocketServer, game: OnlineGameState) {
  const { yes, total } = countRematchAnswers(game);
  io.to(game.roomId).emit("game:rematch_intents", {
    yes,
    total,
    answers: Object.fromEntries(game.rematchIntents),
  });
}
