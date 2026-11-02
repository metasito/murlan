import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db, type Database, type Tx } from "../store/db.ts";
import { userRatings, users } from "../../shared/schema.ts";
import {
  PROVISIONAL_ROUNDS,
  provisionalLeft,
  ratedFinishers,
  seasonKey,
  seedRating,
  START_RATING,
  type RatedSeat,
} from "../../lib/game/rating.ts";
import type { LeaderboardEntryDto, RatingDto } from "../../shared/http.ts";

/** How many players the public ladder shows. */
const LEADERBOARD_SIZE = 50;

/** Either the pool or an open transaction — currentRows only ever reads. */
type Reader = Database | Tx;

type SeasonRow = { rating: number; rounds: number };

/**
 * The row each player starts this season on: their own if they have one,
 * otherwise a soft reset from whatever they finished the most recent past
 * season with. One query for any number of players; every id asked about is
 * answered.
 */
export async function currentRows(
  tx: Pick<Reader, "selectDistinctOn">,
  userIds: readonly string[],
  season: string
): Promise<Map<string, SeasonRow>> {
  const ids = [...new Set(userIds)];
  // `season` sorts lexicographically because it is YYYY-MM, so "the latest
  // season up to this one" is a plain descending order with no date parsing.
  const latest =
    ids.length === 0
      ? []
      : await tx
          .selectDistinctOn([userRatings.userId], {
            userId: userRatings.userId,
            season: userRatings.season,
            rating: userRatings.rating,
            rounds: userRatings.rounds,
          })
          .from(userRatings)
          .where(and(inArray(userRatings.userId, ids), lte(userRatings.season, season)))
          .orderBy(userRatings.userId, desc(userRatings.season));
  const byUser = new Map(latest.map((r) => [r.userId, r]));
  return new Map(
    ids.map((id): [string, SeasonRow] => {
      const row = byUser.get(id);
      return [
        id,
        row?.season === season
          ? { rating: row.rating, rounds: row.rounds }
          : { rating: seedRating(row ? row.rating : null), rounds: 0 },
      ];
    })
  );
}

async function currentRow(tx: Reader, userId: string, season: string): Promise<SeasonRow> {
  return (await currentRows(tx, [userId], season)).get(userId)!;
}

/**
 * Which seats this round rates, re-ranked so a dropped account closes the gap it leaves. `live`
 * is the accounts the results transaction locked (`lockUsers`): an account deleted mid-round
 * still holds its seat in the results, and cannot be rated.
 */
export async function ratedSeatsOf(
  tx: Tx,
  seatResults: { userId: string; placement: number }[],
  gameMode: string,
  season: string,
  live: ReadonlySet<string>
): Promise<RatedSeat[]> {
  if (gameMode !== "free_for_all") return [];
  // Re-run rather than filter in place: the deltas read placement as a rank out
  // of the seats present, so dropping one has to close the gap it leaves.
  const finishers = ratedFinishers(ratedFinishers(seatResults).filter((f) => live.has(f.userId)));
  if (finishers.length < 2) return [];
  const rows = await currentRows(tx, finishers.map((f) => f.userId), season);
  return finishers.map((f): RatedSeat => ({ userId: f.userId, placement: f.placement, ...rows.get(f.userId)! }));
}

/** This season's standing for one player, seeded but not yet written if unplayed. */
export async function getRating(userId: string, asOf: Date): Promise<RatingDto> {
  const season = seasonKey(asOf);
  const { rating, rounds } = await currentRow(db(), userId, season);
  return { season, rating, rounds, provisional: provisionalLeft({ rounds }) !== undefined };
}

/** The current season's ladder. Provisional records are not listed. */
export async function getLeaderboard(asOf: Date): Promise<LeaderboardEntryDto[]> {
  const season = seasonKey(asOf);
  const rows = await db()
    .select({
      userId: userRatings.userId,
      username: users.username,
      rating: userRatings.rating,
      rounds: userRatings.rounds,
    })
    .from(userRatings)
    .innerJoin(users, eq(users.id, userRatings.userId))
    // provisionalLeft (lib/game/rating.ts) in SQL: listed once it is undefined.
    .where(and(eq(userRatings.season, season), gte(userRatings.rounds, PROVISIONAL_ROUNDS)))
    .orderBy(desc(userRatings.rating), userRatings.updatedAt)
    .limit(LEADERBOARD_SIZE);

  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

/**
 * This season's standing for a fixed set of players, the viewer among them.
 * Unlike the public ladder it lists provisional and unplayed records, each on
 * the rating `getRating` would report for them.
 */
export async function getCircleLeaderboard(userIds: string[], asOf: Date): Promise<LeaderboardEntryDto[]> {
  const season = seasonKey(asOf);
  const members = await db()
    .select({ userId: users.id, username: users.username })
    .from(users)
    .where(inArray(users.id, [...new Set(userIds)]));
  const current = await currentRows(db(), members.map((m) => m.userId), season);
  const rows = members.map((m) => ({ ...m, ...current.get(m.userId)! }));
  // Code-unit order, not localeCompare: a tie must break the same way on every server.
  rows.sort((a, b) => b.rating - a.rating || (a.username < b.username ? -1 : 1));
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

export { PROVISIONAL_ROUNDS, START_RATING };
