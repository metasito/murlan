// server/game/roundResults.ts — the one writer of a finished round's results: stats, ratings,
// round history, achievements, the replay and the room's status, in one transaction that also
// clears the round from the table's row (ADR 0014, decision 1).
import { now } from "../http/clock.ts";
import { eq, sql } from "drizzle-orm";
import { transaction } from "../store/db.ts";
import { lockUsers } from "../store/userLock.ts";
import type { TableStore } from "./tableRuntime.ts";
import { rooms, roundHistory, roundReplays, userAchievements, userRatings, userStats } from "../../shared/schema.ts";
import { evaluateAchievements } from "../../lib/achievements.ts";
import { placementPoints } from "../../lib/game/gameEngine.ts";
import { isBotSeatKey } from "../../lib/game/botSeat.ts";
import { ratingDeltas, seasonKey } from "../../lib/game/rating.ts";
import { replayPlayerIdsOf } from "./replayShape.ts";
import { ratedSeatsOf } from "./ratings.ts";
import { MAX_HISTORY_ROWS_PER_USER } from "./stats.ts";
import type { PendingResult } from "../../shared/persistedEnvelope.ts";
import type { RoundOverPayload } from "../../shared/protocol.ts";

/** What the commit did to the ladder, as `game:round_over` states it. */
export type CommittedRatings = Pick<RoundOverPayload, "ratingDeltas" | "ratingsAfter">;

/** `absent`: the row holds no such round at this epoch, and nothing was written. */
export type ResultsCommit = { kind: "committed"; ratings: CommittedRatings } | { kind: "absent" };

const ABSENT = Symbol("absent");

/**
 * Commits one pending round under `epoch`. Its statement count is fixed, whatever the seat
 * count: each table is written by one multi-row statement.
 */
export async function commitRoundResults(
  games: Pick<TableStore["games"], "clearPendingResult">,
  roomId: string,
  epoch: number,
  entry: PendingResult,
  opts: { markFinished: boolean }
): Promise<ResultsCommit> {
  const finishedAt = new Date(entry.finishedAt);
  const humans = entry.results.filter((r) => !isBotSeatKey(r.userId));
  try {
    const ratings = await transaction(async (tx) => {
      const live = await lockUsers(tx, humans.map((r) => r.userId));
      const seated = humans.filter((r) => live.has(r.userId));

      const rated = await ratedSeatsOf(tx, entry.results, entry.gameMode, seasonKey(finishedAt), live);
      const deltas = ratingDeltas(rated);
      const after = rated.map((s) => ({
        userId: s.userId,
        delta: deltas.get(s.userId) ?? 0,
        rating: s.rating + (deltas.get(s.userId) ?? 0),
        rounds: s.rounds + 1,
      }));
      if (after.length > 0) {
        await tx
          .insert(userRatings)
          .values(after.map((a) => ({ userId: a.userId, season: seasonKey(finishedAt), rating: a.rating, rounds: a.rounds })))
          .onConflictDoUpdate({
            target: [userRatings.userId, userRatings.season],
            set: {
              rating: sql`excluded.rating`,
              rounds: sql`excluded.rounds`,
              updatedAt: new Date(now()),
            },
          });
      }

      if (seated.length > 0) {
        // The inserted row is this round alone; the update folds it into the stored one.
        await tx
          .insert(userStats)
          .values(
            seated.map((r) => ({
              userId: r.userId,
              roundsPlayed: 1,
              roundsWon: r.placement === 1 ? 1 : 0,
              matchesWon: r.matchWon ? 1 : 0,
              currentStreak: r.placement === 1 ? 1 : 0,
              bestStreak: r.placement === 1 ? 1 : 0,
              bombsPlayed: r.playedBomb ? 1 : 0,
              updatedAt: new Date(now()),
            }))
          )
          .onConflictDoUpdate({
            target: userStats.userId,
            set: {
              roundsPlayed: sql`${userStats.roundsPlayed} + 1`,
              roundsWon: sql`${userStats.roundsWon} + excluded.rounds_won`,
              matchesWon: sql`${userStats.matchesWon} + excluded.matches_won`,
              currentStreak: sql`case when excluded.rounds_won = 1 then ${userStats.currentStreak} + 1 else 0 end`,
              bestStreak: sql`case when excluded.rounds_won = 1
                then greatest(${userStats.bestStreak}, ${userStats.currentStreak} + 1)
                else ${userStats.bestStreak} end`,
              bombsPlayed: sql`${userStats.bombsPlayed} + excluded.bombs_played`,
              updatedAt: sql`excluded.updated_at`,
            },
          });

        await tx.insert(roundHistory).values(
          seated.map((r) => ({
            userId: r.userId,
            finishedAt,
            gameMode: entry.gameMode,
            placement: r.placement,
            playerCount: r.playerCount,
            points: placementPoints(r.placement - 1, r.playerCount),
            opponents: entry.results.filter((o) => o.userId !== r.userId).map((o) => o.userId),
            ratingDelta: deltas.get(r.userId) ?? null,
            abandoned: r.abandoned ?? false,
          }))
        );

        // Under the users' row locks, so no other round's row commits between choosing what to
        // keep and deleting the rest.
        await tx.execute(sql`
          DELETE FROM ${roundHistory} WHERE ${roundHistory.id} IN (
            SELECT id FROM (
              SELECT ${roundHistory.id} AS id, row_number() OVER (
                PARTITION BY ${roundHistory.userId}
                ORDER BY ${roundHistory.finishedAt} DESC, ${roundHistory.id} DESC
              ) AS kept
              FROM ${roundHistory}
              WHERE ${roundHistory.userId} IN (${sql.join(seated.map((r) => sql`${r.userId}`), sql`, `)})
            ) ranked WHERE kept > ${MAX_HISTORY_ROWS_PER_USER}
          )`);

        const earned = seated.flatMap((r) => evaluateAchievements(r).map((achievementId) => ({ userId: r.userId, achievementId })));
        if (earned.length > 0) await tx.insert(userAchievements).values(earned).onConflictDoNothing();
      }

      const playerIds = replayPlayerIdsOf(entry.seats);
      if (entry.moveLog && entry.moveLog.length > 0 && playerIds.length > 0) {
        await tx.insert(roundReplays).values({
          roomId,
          finishedAt,
          gameMode: entry.gameMode,
          playerIds,
          seats: entry.seats,
          moves: entry.moveLog,
          opening: entry.opening,
          finishingOrder: entry.outcome.finishingOrder,
        });
      }

      if (opts.markFinished) await tx.update(rooms).set({ status: "finished" }).where(eq(rooms.id, roomId));

      if (!(await games.clearPendingResult(tx, roomId, epoch, entry.round))) throw ABSENT;
      return {
        ratingDeltas: Object.fromEntries(after.map((a) => [a.userId, a.delta])),
        ratingsAfter: Object.fromEntries(after.map((a) => [a.userId, { rating: a.rating, rounds: a.rounds }])),
      };
    });
    return { kind: "committed", ratings };
  } catch (err) {
    if (err === ABSENT) return { kind: "absent" };
    throw err;
  }
}

const TRANSIENT_CODES = new Set([
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "55P03", // lock_not_available
  "57014", // query_canceled: statement_timeout
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
  "53300", // too_many_connections
]);

const TRANSIENT_NETWORK = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN"]);

/** Whether retrying the same commit later can succeed: a lost or saturated connection, a lock or a timeout. */
export function isTransientDbError(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e instanceof Error && depth < 5; e = e.cause, depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && (TRANSIENT_CODES.has(code) || code.startsWith("08") || TRANSIENT_NETWORK.has(code))) {
      return true;
    }
    if (/Connection terminated|timeout exceeded when trying to connect|Query read timeout|connection timeout/i.test(e.message)) {
      return true;
    }
  }
  return false;
}
