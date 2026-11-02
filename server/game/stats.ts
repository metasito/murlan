import { now } from "../http/clock.ts";
import { desc, eq } from "drizzle-orm";
import { db } from "../store/db.ts";
import { userStats, roundHistory, userAchievements } from "../../shared/schema.ts";
import type { UserStats, RoundHistory } from "../../shared/schema.ts";
import type { AchievementStatusDto } from "../../shared/http.ts";
import { ACHIEVEMENTS } from "../../lib/achievements.ts";
import { dailyStreak, utcDay } from "../../lib/streak.ts";

/**
 * Match history kept per user, pruned by every results commit (`roundResults.ts`).
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
