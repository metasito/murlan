import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import { db } from "./db.ts";
import { userStats, matchHistory, userAchievements } from "../shared/schema.ts";
import type { UserStats, MatchHistory } from "../shared/schema.ts";
import { evaluateAchievements, ACHIEVEMENTS } from "../lib/achievements.ts";
import type { GameResult } from "../lib/achievements.ts";
import type { GameMode } from "../lib/gameEngine.ts";

/** Match history is pruned to this many most-recent rows per user on every write. */
const MAX_HISTORY_ROWS_PER_USER = 50;

/** Bot seats carry this synthetic id (see server/onlineGameLogic.ts's
 * `scoreKeyForSeat`) instead of a real users.id — the same convention the
 * scoring path already uses to keep vacated seats out of anything keyed by a
 * real account. */
function isBotId(userId: string): boolean {
  return userId.startsWith("bot:");
}

/**
 * Per-hand score for a placement, mirroring lib/gameEngine.ts's `scoreHand`
 * exactly (N-1 for 1st, down to 0), so match_history.points always agrees
 * with what the scoreboard actually awarded. GameResult (lib/achievements.ts)
 * does not carry the raw score, only placement/playerCount, so this
 * recomputes the same published rule rather than inventing a new one.
 */
function pointsForPlacement(placement: number, playerCount: number): number {
  return Math.max(playerCount - placement, 0);
}

/**
 * Persists one hand's outcome — stats counters, a capped history row, and
 * any newly-earned achievements — for every human player in `results`. Bot
 * seats (`bot:<seat>`) are skipped entirely: they have no `users` row, so
 * writing stats for them would violate every foreign key here.
 *
 * `gameMode` is one value for the whole batch (every result in a single call
 * comes from the same hand). GameResult itself (Task 7's interface) has no
 * gameMode field — match_history.gameMode is NOT NULL, so the caller
 * (server/socket.ts's handleGameOver) threads the real value through as a
 * second argument rather than this module fabricating one.
 *
 * Callers must never `await` this on the game-over path — see the call site
 * in server/socket.ts for why.
 */
export async function recordGameResult(
  results: GameResult[],
  gameMode: GameMode
): Promise<void> {
  const humanResults = results.filter((r) => !isBotId(r.userId));
  if (humanResults.length === 0) return;

  await db.transaction(async (tx) => {
    for (const result of humanResults) {
      const { userId, placement, playerCount, playedBomb, matchWon } = result;
      const won = placement === 1;

      // Single atomic UPSERT: in the UPDATE branch, referencing
      // userStats.currentStreak/bestStreak reads the existing row being
      // updated (standard Postgres upsert semantics), so this needs no
      // separate SELECT and has no read-then-write race.
      await tx
        .insert(userStats)
        .values({
          userId,
          gamesPlayed: 1,
          gamesWon: won ? 1 : 0,
          matchesWon: matchWon ? 1 : 0,
          currentStreak: won ? 1 : 0,
          bestStreak: won ? 1 : 0,
          bombsPlayed: playedBomb ? 1 : 0,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: userStats.userId,
          set: {
            gamesPlayed: sql`${userStats.gamesPlayed} + 1`,
            gamesWon: sql`${userStats.gamesWon} + ${won ? 1 : 0}`,
            matchesWon: sql`${userStats.matchesWon} + ${matchWon ? 1 : 0}`,
            currentStreak: won ? sql`${userStats.currentStreak} + 1` : sql`0`,
            bestStreak: won
              ? sql`GREATEST(${userStats.bestStreak}, ${userStats.currentStreak} + 1)`
              : sql`${userStats.bestStreak}`,
            bombsPlayed: sql`${userStats.bombsPlayed} + ${playedBomb ? 1 : 0}`,
            updatedAt: new Date(),
          },
        });

      // Every other participant in this hand (human or bot) — honest data
      // straight from the batch, not a fabricated field. Bot ids are stored
      // as-is; resolving them to a display label is a read-side concern.
      const opponents = results
        .filter((r) => r.userId !== userId)
        .map((r) => r.userId);

      await tx.insert(matchHistory).values({
        userId,
        gameMode,
        placement,
        playerCount,
        points: pointsForPlacement(placement, playerCount),
        opponents,
      });

      // Prune to the 50 most recent rows for this user, in the same
      // transaction as the insert above, so the table cannot grow without
      // bound. The row just inserted is always among the kept set.
      const keep = await tx
        .select({ id: matchHistory.id })
        .from(matchHistory)
        .where(eq(matchHistory.userId, userId))
        .orderBy(desc(matchHistory.finishedAt))
        .limit(MAX_HISTORY_ROWS_PER_USER);
      await tx
        .delete(matchHistory)
        .where(
          and(
            eq(matchHistory.userId, userId),
            notInArray(
              matchHistory.id,
              keep.map((r) => r.id)
            )
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
    }
  });
}

/** Zeroed stats for a user who has no `user_stats` row yet (never finished a hand). */
function emptyStats(userId: string): UserStats {
  return {
    userId,
    gamesPlayed: 0,
    gamesWon: 0,
    matchesWon: 0,
    currentStreak: 0,
    bestStreak: 0,
    bombsPlayed: 0,
    updatedAt: new Date(0),
  };
}

export async function getUserStats(userId: string): Promise<UserStats> {
  const row = await db.query.userStats.findFirst({
    where: eq(userStats.userId, userId),
  });
  return row ?? emptyStats(userId);
}

export async function getMatchHistory(userId: string): Promise<MatchHistory[]> {
  return db.query.matchHistory.findMany({
    where: eq(matchHistory.userId, userId),
    orderBy: desc(matchHistory.finishedAt),
    limit: MAX_HISTORY_ROWS_PER_USER,
  });
}

export interface AchievementStatus {
  id: string;
  nameKey: string;
  descKey: string;
  unlocked: boolean;
  unlockedAt: string | null;
}

/** The full catalogue (locked and unlocked), for a profile/achievements screen. */
export async function getUserAchievements(userId: string): Promise<AchievementStatus[]> {
  const rows = await db.query.userAchievements.findMany({
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
