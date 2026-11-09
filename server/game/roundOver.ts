import { now } from "../http/clock.ts";
import type { TableRuntime } from "./tableRuntime.ts";
import { logger } from "../shared/logger.ts";
import { arm, clearRoomTimers, clearRoomDisconnectTimers, voteDeadlineMs } from "./gameTimers.ts";
import { voteStateOf, type OnlineGameState } from "./gameRoom.ts";
import { resolveRoundEnd, seatTotal } from "./onlineGameLogic.ts";
import { closeMatch, applyRoundFold, rollForward } from "./matchLedger.ts";
import { replaySeatsOf } from "./replayShape.ts";
import { firstTargetFor } from "../../lib/game/gameEngine.ts";
import { activeGames } from "./gameRoom.ts";
import { isTransientDbError, type CommittedRatings } from "./roundResults.ts";
import type { RoundOverPayload } from "../../shared/protocol.ts";
import type { PendingResult, RoundOutcome } from "../../shared/persistedEnvelope.ts";
import { track } from "../shared/inFlight.ts";

/**
 * The database writes a finished round performs, taken as an argument rather
 * than imported: importing them would put storage, stats, ratings and replays
 * behind this module, and the point of splitting it out is that the function
 * deciding who won a match can be run against a hand-built game and a
 * recording runtime. server/game/gamePersistence.ts holds the production set;
 * a table reaches it only as `rt.writers`.
 */
export interface RoundOverWriters {
  updateRoomStatus: (
    roomId: string,
    status: "waiting" | "in_progress" | "finished"
  ) => Promise<void>;
  persistGameState: (roomId: string, game: OnlineGameState) => Promise<unknown>;
  /** The round's final state with its pending results, ahead of every later write for the table. */
  persistFinalState: (roomId: string, game: OnlineGameState) => Promise<unknown>;
  /** Commits `game.pendingResults` oldest first, after every write queued before it. Never rejects. */
  applyPendingResults: (roomId: string, game: OnlineGameState) => Promise<AppliedResults>;
}

/** `held: false`: this process no longer owns the table, and committed nothing more. */
export interface AppliedResults {
  /** `ratings` is null for a round found already applied, whose ratings this process never saw. */
  applied: { entry: PendingResult; ratings: CommittedRatings | null }[];
  held: boolean;
  failure?: unknown;
}

/** docs/GAME-RULES.md § Decisions, "The next-round vote deadline". The next deal clears it. */
export function armVoteDeadline(rt: TableRuntime, roomId: string) {
  arm("voteDeadline", roomId, voteDeadlineMs(), () => void track(rt.expireVoteDeadline(roomId)));
}

/**
 * Resolves a finished round and hands its results to the commit. Never rejects; settles once
 * `game:round_over` has gone out, or the commit was left to retry.
 */
export function handleRoundOver(rt: TableRuntime, roomId: string, game: OnlineGameState): Promise<void> {
  // Cleared here, synchronously: the caller already flipped `state.roundOver`
  // true in this same tick, so a rejoin reading `game.lastRoundOverPayload`
  // must never be able to observe that flag alongside the previous round's payload.
  game.lastRoundOverPayload = undefined;
  const state = game.gameState;
  clearRoomTimers(roomId);
  // A pending grace timer must not fire into a finished game and evict the
  // survivors from the rematch screen.
  clearRoomDisconnectTimers(game);

  const result = resolveRoundEnd({
    state,
    playerMap: game.playerMap,
    cumulativeScores: game.cumulativeScores,
    matchTarget: game.matchTarget,
    matchLength: game.matchLength,
    gameMode: game.gameState.gameMode,
    roundFlags: game.roundFlags,
    abandonedSeats: game.abandonedSeats,
    botSeatsAtStart: game.botSeatsAtStart,
    vacatedSeats: game.vacatedSeats,
  });
  const { roundByKey, matchWinners, isDraw, detailed, winnerEngineIds } = result;
  applyRoundFold(game, result);
  // Before the awaits below, so no rejoin can read the vote without its deadline.
  if (!game.matchOver) armVoteDeadline(rt, roomId);

  const outcome: RoundOutcome = {
    finishingOrder: state.finishingOrder,
    scores: detailed,
    matchTarget: game.matchTarget,
    matchLength: game.matchLength,
    roundsPlayed: game.roundsPlayed,
    matchOver: game.matchOver,
    matchWinnerIds: winnerEngineIds,
    matchContinues: true,
    isDraw,
    recorded: result.recordable,
    voided: false,
  };

  // The one record of how a round resolved. `round_replays` is not a substitute:
  // it is written only for a table with a human seat and a live moveLog, and it
  // stores no scores. Ids and integers only — never hand contents.
  logger.info(
    {
      roomId,
      gameMode: game.gameState.gameMode,
      matchLength: game.matchLength,
      finishingOrder: state.finishingOrder,
      roundByKey,
      cumulative: game.cumulativeScores,
      matchTarget: game.matchTarget,
      matchOver: game.matchOver,
      isDraw,
      matchWinners,
    },
    "Hand over"
  );

  if (!result.recordable) {
    logger.info({ roomId }, "Bot-majority table — stats, history and achievements not recorded");
    announce(rt, game, outcome, null);
    return closeRound(rt, roomId, game, "Failed to set rooms.status = finished after the round ended");
  }

  // One clock for the whole entry: the season key is derived from it, and the
  // history row and the replay are paired on it.
  const finishedAt = Math.max(now(), (game.pendingResults.at(-1)?.round ?? 0) + 1);
  game.pendingResults.push({
    round: finishedAt,
    finishedAt,
    gameMode: game.gameState.gameMode,
    results: result.gameResults,
    outcome,
    seats: replaySeatsOf(state.players, game.playerMap, game.vacatedSeats),
    opening: game.replayOpening ?? null,
    moveLog: game.moveLog && game.moveLog.length > 0 ? [...game.moveLog] : null,
  });
  game.roundOverDue = finishedAt;
  void track(rt.writers.persistFinalState(roomId, game));
  return settleRoundResults(rt, game);
}

/** Per room: the delay before the next retry of a transient failure, and its timer. */
const retries = new Map<string, { delayMs: number; timer: ReturnType<typeof setTimeout> | null }>();
const RETRY_FIRST_MS = 500;
const RETRY_MAX_MS = 5_000;
let failedCommits = 0;

/**
 * Commits the table's pending rounds and announces the one the table is waiting on: with the
 * committed ratings, or, when its commit failed, without them so the table moves on. A transient
 * failure is retried on a backoff while this process holds the table; any other is logged and
 * counted, and waits for the next round's commit, a restore or the sweep. Never rejects.
 */
export async function settleRoundResults(rt: TableRuntime, game: OnlineGameState): Promise<void> {
  const { roomId } = game;
  const { applied, held, failure } = await rt.writers.applyPendingResults(roomId, game);
  for (const { entry, ratings } of applied) {
    if (game.roundOverDue === entry.round) announce(rt, game, entry.outcome, ratings);
  }
  if (!held) return;
  if (failure === undefined) {
    const retry = retries.get(roomId);
    if (retry?.timer) clearTimeout(retry.timer);
    retries.delete(roomId);
    return;
  }

  const head = game.pendingResults[0];
  if (isTransientDbError(failure)) {
    logger.warn({ err: failure, roomId, round: head?.round }, "A finished round's results did not commit — retrying");
    scheduleRetry(rt, roomId);
  } else {
    failedCommits += 1;
    logger.error({ err: failure, roomId, entry: head }, "A finished round's results failed to commit — left pending");
  }
  const due = game.pendingResults.find((e) => e.round === game.roundOverDue);
  if (due) {
    announce(rt, game, due.outcome, null);
    void track(rt.writers
      .updateRoomStatus(roomId, "finished")
      .catch((err: unknown) => logger.warn({ err, roomId }, "Failed to set rooms.status = finished after the round ended")));
  }
}

function scheduleRetry(rt: TableRuntime, roomId: string): void {
  const retry = retries.get(roomId) ?? { delayMs: RETRY_FIRST_MS, timer: null };
  retries.set(roomId, retry);
  if (retry.timer) return;
  const delayMs = retry.delayMs;
  retry.delayMs = Math.min(delayMs * 2, RETRY_MAX_MS);
  retry.timer = setTimeout(() => {
    retry.timer = null;
    // Whichever game holds the table now: a new match at it carries the same pending rounds.
    const live = activeGames.get(roomId);
    if (live && live.pendingResults.length > 0) void track(settleRoundResults(rt, live));
    else retries.delete(roomId);
  }, delayMs);
  (retry.timer as unknown as { unref?: () => void }).unref?.();
}

/** How long the oldest round this process holds has waited for its results commit; 0 with none. */
export function roundResultsPendingAgeSeconds(): number {
  let oldest = Infinity;
  for (const game of activeGames.values()) oldest = Math.min(oldest, game.pendingResults[0]?.finishedAt ?? Infinity);
  return oldest === Infinity ? 0 : Math.max(0, (now() - oldest) / 1000);
}

let unreadableRounds = 0;

/** Rounds a restore found in a row and could not read, so cannot commit; the row keeps them. */
export function noteUnreadableResults(roomId: string, count: number): void {
  if (count === 0) return;
  unreadableRounds += count;
  logger.error({ roomId, count }, "A table's row holds pending results that do not parse — they cannot be committed");
}

/** Pending rounds found unreadable in a row, since the process started. */
export function roundResultsUnreadableCount(): number {
  return unreadableRounds;
}

/** Commits that failed for a reason a retry cannot fix, since the process started. */
export function roundResultsFailureCount(): number {
  return failedCommits;
}

function announce(rt: TableRuntime, game: OnlineGameState, outcome: RoundOutcome, ratings: CommittedRatings | null): void {
  game.roundOverDue = undefined;
  const over: RoundOverPayload = { ...outcome, ratingDeltas: ratings?.ratingDeltas ?? {}, ratingsAfter: ratings?.ratingsAfter ?? {} };
  rt.out.room(game.roomId).emit("game:round_over", over);
  if (!outcome.matchOver) rt.out.room(game.roomId).emit("game:vote_state", voteStateOf(game));
  // Kept so `announceRejoin` can hand this round's scores to a client that
  // rejoins after everyone still in the room has already been sent them.
  game.lastRoundOverPayload = over;
}

/** A round that records nothing: its status and its row, through the chain. */
async function closeRound(rt: TableRuntime, roomId: string, game: OnlineGameState, failed: string): Promise<void> {
  await rt.writers.updateRoomStatus(roomId, "finished").catch((err: unknown) => logger.warn({ err, roomId }, failed));
  // The row is kept (not deleted) so a restart between rounds restores the
  // running match instead of silently resetting the scoreboard. Awaited so a
  // caller that disposes the table straight after cannot delete the row
  // before this write lands on it.
  await rt.writers.persistGameState(roomId, game);
}

/**
 * Ends the match without scoring whatever round was in progress: nothing is
 * folded into `cumulativeScores`, `roundsPlayed` does not advance, and no
 * stats/rating/replay write runs — the whole point being that this round
 * never happened. `game:round_over` still goes out, so the table's clients leave
 * the game screen the one way they know how, rather than being torn down.
 */
async function closeMatchWithoutScoring(
  rt: TableRuntime,
  roomId: string,
  game: OnlineGameState,
  voided: boolean
): Promise<void> {
  game.lastRoundOverPayload = undefined;
  clearRoomTimers(roomId);
  clearRoomDisconnectTimers(game);
  game.gameState.roundOver = true;
  closeMatch(game, { endedByVote: !voided });

  const over: RoundOverPayload = {
    finishingOrder: [],
    scores: [],
    matchTarget: game.matchTarget,
    matchLength: game.matchLength,
    roundsPlayed: game.roundsPlayed,
    matchOver: true,
    matchWinnerIds: [],
    matchContinues: false,
    isDraw: false,
    ratingDeltas: {},
    ratingsAfter: {},
    recorded: false,
    voided,
  };
  rt.out.room(roomId).emit("game:round_over", over);
  game.lastRoundOverPayload = over;
  await closeRound(rt, roomId, game, "Failed to set rooms.status = finished after the match closed with no further scoring");
}

/**
 * A match abandoned before its first point (docs/GAME-RULES.md § Decisions): nothing
 * earned, nothing taken, rated for nobody — not even the seat that walked
 * out. The caller disposes the table; there is nobody left to show a
 * results screen to.
 */
export async function voidAbandonedMatch(rt: TableRuntime, roomId: string, game: OnlineGameState): Promise<void> {
  await closeMatchWithoutScoring(rt, roomId, game, true);
}

/**
 * The table's own unanimous vote to end a match a seat has been vacated
 * from (docs/GAME-RULES.md § Decisions) — penalty-free for everyone still present. Every
 * round already finished stays exactly as recorded; only the one in progress,
 * if any, goes unscored. The table is left in place, at the results screen,
 * rather than disposed: the players who agreed to stop are still here.
 */
export async function endMatchByAgreement(rt: TableRuntime, roomId: string, game: OnlineGameState): Promise<void> {
  await closeMatchWithoutScoring(rt, roomId, game, false);
}

/** Between rounds: a finished match starts over, an unfinished one carries on. */
export function rollMatchForward(game: OnlineGameState) {
  if (game.matchOver) rollForward(game, firstTargetFor(game.gameState.players.length));
}

/**
 * Cumulative match points keyed by engine player id — the identity `finishingOrder`,
 * the match winners and the `game:round_over` scoreboard are all stated in. Keying
 * it by display name collapsed two seats sharing one, silently.
 */
export function scoresByEngineId(game: OnlineGameState): Record<string, number> {
  const byId: Record<string, number> = {};
  game.gameState.players.forEach((p, seat) => {
    byId[p.id] = seatTotal(game.cumulativeScores, game.playerMap, game.vacatedSeats, seat);
  });
  return byId;
}
