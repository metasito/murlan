import { now } from "../http/clock.ts";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "../store/db.ts";
import { userRatings, users } from "../../shared/schema.ts";
import { lockUsers } from "../store/userLock.ts";
import {
  PROVISIONAL_ROUNDS,
  ratedFinishers,
  ratingDeltas,
  seasonKey,
  seedRating,
  START_RATING,
  type RatedSeat,
} from "../../lib/game/rating.ts";
import type { RatingAfter } from "../../lib/game/matchState.ts";
import type { LeaderboardEntryDto, RatingDto } from "../../shared/http.ts";

/** How many players the public ladder shows. */
const LEADERBOARD_SIZE = 50;

export interface RatedPreview extends RatingAfter {
  delta: number;
}

/** Either the pool or an open transaction — currentRows only ever reads. */
type Reader = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

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
 * Which seats this round actually rates, re-ranked so a dropped account closes
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

  const rows = await currentRows(reader, finishers.map((f) => f.userId), season);
  return finishers.map((f): RatedSeat => ({ userId: f.userId, placement: f.placement, ...rows.get(f.userId)! }));
}

/**
 * What this round is about to do to each seat's rating, read before the write
 * and before `game:round_over` goes out.
 *
 * The delta cannot be recovered afterwards: `user_ratings` keeps only the
 * current rating, while `ratingDeltas()` needs every seat's rating and round
 * count as they were *before* the round. This is the only moment it exists, so
 * it is read here and carried — one query, on a path that already awaits
 * several, and no client waits on the write that follows.
 *
 * A table that earns no rating returns an empty map, which is the panel's
 * empty state rather than a row of zeroes.
 *
 * `rating` and `games` are what the write will leave, so a client can show the
 * new standing without reading the ladder before that write commits.
 */
export async function previewRatedDeltas(
  seatResults: { userId: string; placement: number }[],
  gameMode: string,
  finishedAt: Date
): Promise<Map<string, RatedPreview>> {
  const seats = await ratedSeatsOf(seatResults, gameMode, seasonKey(finishedAt), db);
  if (seats.length < 2) return new Map();
  const deltas = ratingDeltas(seats);
  return new Map(
    seats.map((seat) => {
      const delta = deltas.get(seat.userId) ?? 0;
      return [seat.userId, { delta, rating: seat.rating + delta, rounds: seat.rounds + 1 }];
    })
  );
}

/**
 * Applies one round's result to the ladder. Drops bots itself by the same
 * `bot:<seat>` convention scoring uses, so no caller has to reverse-map a score
 * key back to a seat. Free-for-all only — a teams placement belongs to the team.
 *
 * One transaction, so a round moves every seat or none. Which is why the seats
 * are checked against `users` first: an account deleted mid-round still holds a
 * seat, and its foreign key would abort everyone else's rating with it.
 *
 * Returns the deltas it committed, empty when it rated nobody.
 */
export async function recordRatedResult(
  seatResults: { userId: string; placement: number }[],
  gameMode: string,
  finishedAt: Date
): Promise<Map<string, number>> {
  const season = seasonKey(finishedAt);

  return db.transaction(async (tx) => {
    // Resolved inside the transaction and under every seat's row lock, not
    // taken from the preview: the absolute values written below are only
    // right if no other round's write lands between this read and them.
    await lockUsers(tx, ratedFinishers(seatResults).map((f) => f.userId));
    const seats = await ratedSeatsOf(seatResults, gameMode, season, tx);
    if (seats.length < 2) return new Map<string, number>();

    const deltas = ratingDeltas(seats);
    for (const seat of seats) {
      const delta = deltas.get(seat.userId) ?? 0;
      await tx
        .insert(userRatings)
        .values({
          userId: seat.userId,
          season,
          rating: seat.rating + delta,
          rounds: seat.rounds + 1,
        })
        .onConflictDoUpdate({
          target: [userRatings.userId, userRatings.season],
          set: {
            rating: seat.rating + delta,
            rounds: seat.rounds + 1,
            updatedAt: new Date(now()),
          },
        });
    }
    return deltas;
  });
}

/** This season's standing for one player, seeded but not yet written if unplayed. */
export async function getRating(userId: string, asOf: Date): Promise<RatingDto> {
  const season = seasonKey(asOf);
  const { rating, rounds } = await currentRow(db, userId, season);
  return { season, rating, rounds, provisional: rounds < PROVISIONAL_ROUNDS };
}

/** The current season's ladder. Provisional records are not listed. */
export async function getLeaderboard(asOf: Date): Promise<LeaderboardEntryDto[]> {
  const season = seasonKey(asOf);
  const rows = await db
    .select({
      userId: userRatings.userId,
      username: users.username,
      rating: userRatings.rating,
      rounds: userRatings.rounds,
    })
    .from(userRatings)
    .innerJoin(users, eq(users.id, userRatings.userId))
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
  const members = await db
    .select({ userId: users.id, username: users.username })
    .from(users)
    .where(inArray(users.id, [...new Set(userIds)]));
  const current = await currentRows(db, members.map((m) => m.userId), season);
  const rows = members.map((m) => ({ ...m, ...current.get(m.userId)! }));
  // Code-unit order, not localeCompare: a tie must break the same way on every server.
  rows.sort((a, b) => b.rating - a.rating || (a.username < b.username ? -1 : 1));
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

export { PROVISIONAL_ROUNDS, START_RATING };
