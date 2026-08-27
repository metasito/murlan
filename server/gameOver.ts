import type { Server as SocketServer } from "socket.io";
import { logger } from "./logger.ts";
import { clearRoomTimers, clearRoomDisconnectTimers } from "./gameTimers.ts";
import { scoreKeyForSeat } from "./gameRoom.ts";
import type { OnlineGameState } from "./gameRoom.ts";
import { resolveHandEnd } from "./onlineGameLogic.ts";
import { replaySeatsOf } from "./replayShape.ts";
import { isMajority, tallyRematchAnswers, targetsFor } from "../lib/gameEngine.ts";
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
  });
  const { handByKey, matchWinners, isDraw, detailed, byName, winnerNames } = result;
  game.cumulativeScores = result.cumulativeScores;
  game.matchTarget = result.matchTarget;
  game.matchOver = result.matchOver;

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

  io.to(roomId).emit("game:over", {
    rankings: state.rankings,
    cumulativeScores: byName,
    scores: detailed,
    matchTarget: game.matchTarget,
    matchLength: game.matchLength,
    matchOver: game.matchOver,
    matchWinners: winnerNames,
    matchContinues,
    isDraw,
    // Keyed by user id, and absent for a table that earns no rating — an
    // offline or teams hand, or one without two rated finishers. The client
    // shows its empty state on absence rather than on a zero, which is a real
    // outcome.
    ratingDeltas: Object.fromEntries(ratingDeltasByUser),
  });

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
      writers.recordGameResult(gameResults, game.gameMode, ratingDeltasByUser).catch((err) =>
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

    // A replay is written for any table with a human seat, bot-majority ones
    // included: it records what happened, it awards nothing. Not awaited, and
    // the table is not required to exist — until `db:push` has run the insert
    // fails, is logged, and the only consequence is an empty replays list.
    if (game.moveLog && game.moveLog.length > 0) {
      writers.saveReplay({
        roomId,
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

/** Between hands: a finished match starts over, an unfinished one carries on. */
export function rollMatchForward(game: OnlineGameState) {
  if (game.matchOver) {
    const [target] = targetsFor(game.gameState.players.length);
    if (target === undefined) {
      throw new Error(`targetsFor(${game.gameState.players.length}) returned no targets`);
    }
    game.cumulativeScores = {};
    game.matchTarget = target;
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
 * Cumulative match points keyed by display name — the one wire shape clients
 * read, matching what `game:over` ships.
 */
export function scoresByName(game: OnlineGameState): Record<string, number> {
  const byName: Record<string, number> = {};
  game.gameState.players.forEach((p, seat) => {
    byName[p.name] = game.cumulativeScores[scoreKeyForSeat(game, seat)] ?? 0;
  });
  return byName;
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
