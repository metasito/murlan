import { now } from "../http/clock.ts";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../store/db.ts";
import { lockUsers } from "../store/userLock.ts";
import { logger } from "../shared/logger.ts";
import { userStats, roundHistory, userAchievements } from "../../shared/schema.ts";
import type { UserStats, RoundHistory } from "../../shared/schema.ts";
import type { AchievementStatusDto } from "../../shared/http.ts";
import { evaluateAchievements, ACHIEVEMENTS } from "../../lib/achievements.ts";
import type { GameResult } from "../../lib/achievements.ts";
import { placementPoints, type GameMode } from "../../lib/game/gameEngine.ts";
import { dailyStreak, utcDay } from "../../lib/streak.ts";
import { isBotSeatKey } from "../../lib/game/botSeat.ts";

/**
 * Match history kept per user, pruned on every write.
 *
 * This is a display list — the profile screen's "recent matches" — not an
 * archive, and fifty is about as far back as anyone scrolls. It bounds the
 * table's growth per user, which is the property that actually matters.
 *
 * The same number bounds the read: reading more than is kept would show rows
 * on their way to being deleted, and reading fewer would hide rows that were
 * deliberately retained. They must not become two numbers.
 */
export const MAX_HISTORY_ROWS_PER_USER = 50;

/**
 * Persists one round's outcome for every human in `results`. Bot seats
 * (`bot:<seat>`) are skipped: no `users` row, so every foreign key here would
 * fail. `gameMode` is threaded in because GameResult has no such field and
 * `round_history.gameMode` is NOT NULL.
 *
 * Callers must never `await` this on the game-over path — see handleRoundOver.
 */
export async function recordGameResult(
  results: GameResult[],
  gameMode: GameMode,
  /**
   * The round's one end time, shared with the replay written beside this. It is
   * required rather than defaulted so that `(userId, finishedAt)` pairs the two
   * exactly — a caller falling back to `defaultNow()` would leave the pairing
   * to whichever write the database served first.
   */
  finishedAt: Date,
  /**
   * What this round did to each seat's ladder rating, read before the round was
   * written (server/game/ratings.ts `previewRatedDeltas`). Absent for every seat a
   * table did not rate, which is what leaves `rating_delta` null rather than
   * claiming a rated match that moved nobody.
   */
  ratingDeltas: Map<string, number> = new Map()
): Promise<void> {
  const humanResults = results.filter((r) => !isBotSeatKey(r.userId));
  if (humanResults.length === 0) return;

  for (const result of humanResults) {
    // One transaction per seat, not one for the whole round: an account deleted
    // mid-round still holds its seat in `results`, and its insert violates a
    // foreign key. Sharing a transaction would roll that failure back over
    // every other player's stats, history and achievements for the round.
    await db()
      .transaction(async (tx) => {
        const { userId, placement, playerCount, playedBomb, matchWon, abandoned } = result;
        const won = placement === 1;
        await lockUsers(tx, [userId]);

        // Single atomic UPSERT: in the UPDATE branch, referencing
        // userStats.currentStreak/bestStreak reads the existing row being
        // updated (standard Postgres upsert semantics), so this needs no
        // separate SELECT and has no read-then-write race.
        await tx
          .insert(userStats)
          .values({
            userId,
            roundsPlayed: 1,
            roundsWon: won ? 1 : 0,
            matchesWon: matchWon ? 1 : 0,
            currentStreak: won ? 1 : 0,
            bestStreak: won ? 1 : 0,
            bombsPlayed: playedBomb ? 1 : 0,
            updatedAt: new Date(now()),
          })
          .onConflictDoUpdate({
            target: userStats.userId,
            set: {
              roundsPlayed: sql`${userStats.roundsPlayed} + 1`,
              roundsWon: sql`${userStats.roundsWon} + ${won ? 1 : 0}`,
              matchesWon: sql`${userStats.matchesWon} + ${matchWon ? 1 : 0}`,
              currentStreak: won ? sql`${userStats.currentStreak} + 1` : sql`0`,
              bestStreak: won
                ? sql`GREATEST(${userStats.bestStreak}, ${userStats.currentStreak} + 1)`
                : sql`${userStats.bestStreak}`,
              bombsPlayed: sql`${userStats.bombsPlayed} + ${playedBomb ? 1 : 0}`,
              updatedAt: new Date(now()),
            },
          });

        // Every other participant in this round (human or bot) — honest data
        // straight from the batch, not a fabricated field. Bot ids are stored
        // as-is; resolving them to a display label is a read-side concern.
        const opponents = results
          .filter((r) => r.userId !== userId)
          .map((r) => r.userId);

        await tx.insert(roundHistory).values({
          userId,
          finishedAt,
          gameMode,
          placement,
          playerCount,
          points: placementPoints(placement - 1, playerCount),
          opponents,
          ratingDelta: ratingDeltas.get(userId) ?? null,
          abandoned: abandoned ?? false,
        });

        // Prune in the same transaction as the insert above, so the table
        // cannot grow without bound. One statement under the row lock, so no
        // other round's row can commit between choosing what to keep and
        // deleting the rest.
        await tx
          .delete(roundHistory)
          .where(
            and(
              eq(roundHistory.userId, userId),
              sql`${roundHistory.id} NOT IN (
                SELECT ${roundHistory.id} FROM ${roundHistory}
                WHERE ${roundHistory.userId} = ${userId}
                ORDER BY ${roundHistory.finishedAt} DESC, ${roundHistory.id} DESC
                LIMIT ${MAX_HISTORY_ROWS_PER_USER}
              )`
            )
          );

        const earnedIds = evaluateAchievements(result);
        if (earnedIds.length > 0) {
          // Composite primary key (userId, achievementId) makes this
          // idempotent by construction — no read-then-write race to check
          // "already unlocked" first.
          await tx
            .insert(userAchievements)
            .values(earnedIds.map((achievementId) => ({ userId, achievementId })))
            .onConflictDoNothing();
        }
      })
      .catch((err) =>
        logger.error(
          { err, userId: result.userId },
          "Failed to record one seat's result — the rest of the table still gets theirs"
        )
      );
  }
}

/** Zeroed stats for a user who has no `user_stats` row yet (never finished a round). */
function emptyStats(userId: string): UserStats {
  return {
    userId,
    roundsPlayed: 0,
    roundsWon: 0,
    matchesWon: 0,
    currentStreak: 0,
    bestStreak: 0,
    bombsPlayed: 0,
    updatedAt: new Date(0),
  };
}

/** userStats plus the figures derived from match history rather than stored. */
export interface UserStatsView extends UserStats {
  /** Consecutive days played, counting back from today. */
  dailyStreak: number;
}

export async function getUserStats(userId: string): Promise<UserStatsView> {
  const [row, played] = await Promise.all([
    db().query.userStats.findFirst({ where: eq(userStats.userId, userId) }),
    db()
      .select({ finishedAt: roundHistory.finishedAt })
      .from(roundHistory)
      .where(eq(roundHistory.userId, userId))
      .orderBy(desc(roundHistory.finishedAt))
      .limit(MAX_HISTORY_ROWS_PER_USER),
  ]);

  // Derived from history rather than stored in its own columns. New columns on
  // user_stats could not be written until someone ran db:push in production, and
  // until they did *every* stats write would fail — a far worse outcome than
  // this figure being approximate. It is bounded by the retained history, so a
  // player with more than MAX_HISTORY_ROWS_PER_USER matches inside their streak
  // would see it undercounted; a match is a full match, so that is a great
  // many matches in a row of days.
  return {
    ...(row ?? emptyStats(userId)),
    dailyStreak: dailyStreak(
      played.map((r) => r.finishedAt),
      utcDay(new Date(now()))
    ),
  };
}

export async function getRoundHistory(userId: string): Promise<RoundHistory[]> {
  return db().query.roundHistory.findMany({
    where: eq(roundHistory.userId, userId),
    orderBy: desc(roundHistory.finishedAt),
    limit: MAX_HISTORY_ROWS_PER_USER,
  });
}

/** The full catalogue (locked and unlocked), for a profile/achievements screen. */
export async function getUserAchievements(userId: string): Promise<AchievementStatusDto[]> {
  const rows = await db().query.userAchievements.findMany({
    where: eq(userAchievements.userId, userId),
  });
  const unlockedAt = new Map(rows.map((r) => [r.achievementId, r.unlockedAt]));
  return ACHIEVEMENTS.map((a) => ({
    id: a.id,
    nameKey: a.nameKey,
    descKey: a.descKey,
    unlocked: unlockedAt.has(a.id),
    unlockedAt: unlockedAt.get(a.id)?.toISOString() ?? null,
  }));
}
