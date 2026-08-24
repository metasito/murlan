import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "./db.ts";
import { userRatings, users } from "../shared/schema.ts";
import {
  PROVISIONAL_GAMES,
  ratedFinishers,
  ratingDeltas,
  seasonKey,
  seedRating,
  START_RATING,
  type RatedSeat,
} from "../lib/rating.ts";

/** How many players the public ladder shows. */
export const LEADERBOARD_SIZE = 50;

export interface RatingView {
  season: string;
  rating: number;
  games: number;
  /** True until the record is long enough to list publicly. */
  provisional: boolean;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  rating: number;
  games: number;
}

/** Either the pool or an open transaction — currentRow only ever reads. */
type Reader = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The row a player starts this season on: their own if they have one, otherwise
 * a soft reset from whatever they finished the most recent past season with.
 */
async function currentRow(
  tx: Reader,
  userId: string,
  season: string
): Promise<{ rating: number; games: number }> {
  const [existing] = await tx
    .select()
    .from(userRatings)
    .where(and(eq(userRatings.userId, userId), eq(userRatings.season, season)))
    .limit(1);
  if (existing) return { rating: existing.rating, games: existing.games };

  // `season` sorts lexicographically because it is YYYY-MM, so "the latest
  // season before this one" is a plain descending order with no date parsing.
  const [previous] = await tx
    .select()
    .from(userRatings)
    .where(and(eq(userRatings.userId, userId), sql`${userRatings.season} < ${season}`))
    .orderBy(desc(userRatings.season))
    .limit(1);

  return { rating: seedRating(previous ? previous.rating : null), games: 0 };
}

/**
 * Which seats this hand actually rates, re-ranked so a dropped account closes
 * the gap it leaves. Shared by the preview and the write so the two cannot
 * disagree about who is in the table.
 */
async function ratedSeatsOf(
  seatResults: { userId: string; placement: number }[],
  gameMode: string,
  season: string,
  reader: Reader
): Promise<RatedSeat[]> {
  if (gameMode !== "free_for_all") return [];

  const seated = ratedFinishers(seatResults);
  if (seated.length < 2) return [];

  const live = await reader
    .select({ id: users.id })
    .from(users)
    .where(
      inArray(
        users.id,
        seated.map((f) => f.userId)
      )
    );
  const liveIds = new Set(live.map((r) => r.id));
  // Re-run rather than filter in place: the deltas read placement as a rank out
  // of the seats present, so dropping one has to close the gap it leaves.
  const finishers = ratedFinishers(seated.filter((f) => liveIds.has(f.userId)));
  // An account that no longer exists cannot be rated, and one contestant is no
  // contest.
  if (finishers.length < 2) return [];

  const seats: RatedSeat[] = [];
  for (const f of finishers) {
    const row = await currentRow(reader, f.userId, season);
    seats.push({ userId: f.userId, placement: f.placement, ...row });
  }
  return seats;
}

/**
 * What this hand is about to do to each seat's rating, read before the write
 * and before `game:over` goes out.
 *
 * The delta cannot be recovered afterwards: `user_ratings` keeps only the
 * current rating, while `ratingDeltas()` needs every seat's rating and game
 * count as they were *before* the hand. This is the only moment it exists, so
 * it is read here and carried — one query, on a path that already awaits
 * several, and no client waits on the write that follows.
 *
 * A table that earns no rating returns an empty map, which is the panel's
 * empty state rather than a row of zeroes.
 */
export async function previewRatedDeltas(
  seatResults: { userId: string; placement: number }[],
  gameMode: string,
  finishedAt: Date
): Promise<Map<string, number>> {
  const seats = await ratedSeatsOf(seatResults, gameMode, seasonKey(finishedAt), db);
  return seats.length < 2 ? new Map() : ratingDeltas(seats);
}

/**
 * Applies one manche's result to the ladder. Drops bots itself by the same
 * `bot:<seat>` convention scoring uses, so no caller has to reverse-map a score
 * key back to a seat. Free-for-all only — a teams placement belongs to the pair.
 *
 * One transaction, so a hand moves every seat or none. Which is why the seats
 * are checked against `users` first: an account deleted mid-hand still holds a
 * seat, and its foreign key would abort everyone else's rating with it.
 */
export async function recordRatedResult(
  seatResults: { userId: string; placement: number }[],
  gameMode: string,
  finishedAt: Date
): Promise<void> {
  const season = seasonKey(finishedAt);

  await db.transaction(async (tx) => {
    // Resolved inside the transaction, not taken from the preview: the write
    // is what the ladder answers to, so it reads the rows it is about to
    // update rather than trusting a number read before it.
    const seats = await ratedSeatsOf(seatResults, gameMode, season, tx);
    if (seats.length < 2) return;

    const deltas = ratingDeltas(seats);
    for (const seat of seats) {
      const delta = deltas.get(seat.userId) ?? 0;
      await tx
        .insert(userRatings)
        .values({
          userId: seat.userId,
          season,
          rating: seat.rating + delta,
          games: seat.games + 1,
        })
        .onConflictDoUpdate({
          target: [userRatings.userId, userRatings.season],
          set: {
            rating: seat.rating + delta,
            games: seat.games + 1,
            updatedAt: new Date(),
          },
        });
    }
  });
}

/** This season's standing for one player, seeded but not yet written if unplayed. */
export async function getRating(userId: string, now: Date): Promise<RatingView> {
  const season = seasonKey(now);
  const { rating, games } = await currentRow(db, userId, season);
  return { season, rating, games, provisional: games < PROVISIONAL_GAMES };
}

/** The current season's ladder. Provisional records are not listed. */
export async function getLeaderboard(now: Date): Promise<LeaderboardEntry[]> {
  const season = seasonKey(now);
  const rows = await db
    .select({
      userId: userRatings.userId,
      username: users.username,
      rating: userRatings.rating,
      games: userRatings.games,
    })
    .from(userRatings)
    .innerJoin(users, eq(users.id, userRatings.userId))
    .where(and(eq(userRatings.season, season), gte(userRatings.games, PROVISIONAL_GAMES)))
    .orderBy(desc(userRatings.rating), userRatings.updatedAt)
    .limit(LEADERBOARD_SIZE);

  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

export { PROVISIONAL_GAMES, START_RATING };
