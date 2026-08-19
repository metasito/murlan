// The ranked ladder's arithmetic. Pure — no react-native import, no db — so
// both the server and `node --test` load it directly. The one type import is
// erased at compile time and pulls nothing in.
import type { TranslationKey } from "./i18n.ts";
//
// Every constant here carries its own reasoning; the two that are conventions
// rather than measurements (SEASON_CARRY, the K tiers) say so.

/** Where an unrated player starts, and the centre a season's soft reset pulls toward. */
export const START_RATING = 1000;

/** Games before a rating is settled enough to list publicly. */
export const PROVISIONAL_GAMES = 5;

/**
 * How much one result can move a rating. Falls as a record grows, so a new
 * account converges quickly and an established rating stops jittering.
 */
export function kFactor(gamesPlayed: number): number {
  if (gamesPlayed < PROVISIONAL_GAMES * 2) return 40;
  if (gamesPlayed < 30) return 24;
  return 16;
}

/**
 * Half the distance from the mean carries into the next season.
 *
 * A hard reset throws away every game of signal each month; no reset at all
 * ossifies the ladder around whoever played first. Halving is a convention
 * rather than a measurement, which is exactly why it is named.
 */
export const SEASON_CARRY = 0.5;

/**
 * The season a moment belongs to, as `YYYY-MM` in UTC.
 *
 * Derived rather than scheduled: the season a result belongs to *is* its month,
 * so the reset cannot be missed, run twice, or run late. The server sleeps on
 * Replit, and a scheduled reset on a host that sleeps is one that eventually
 * does not happen.
 */
export function seasonKey(at: Date): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * The season as a player should read it: "Agosto 2026", not "2026-08".
 *
 * The key stays exactly as stored — it is half the `user_ratings` primary key
 * and it sorts lexicographically, which is what makes "the season before this
 * one" a plain descending order. This is presentation only.
 *
 * A key that is not `YYYY-MM` is shown as-is rather than mangled into a wrong
 * month: the only way to get one is a future change to `seasonKey`, and a
 * visibly odd label is a better failure than a confidently wrong one.
 */
export function formatSeason(season: string, t: (key: TranslationKey) => string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(season);
  if (!match) return season;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return season;
  return `${t(`month.${month}` as TranslationKey)} ${match[1]}`;
}

/** The rating a player starts a new season on, given how they ended the last one. */
export function seedRating(previousSeasonRating: number | null): number {
  if (previousSeasonRating === null) return START_RATING;
  // Truncated toward the mean, not rounded: rounding lets a rating one point
  // off centre halve to a half-point and round straight back, so an inactive
  // player never actually returns to the middle.
  return START_RATING + Math.trunc((previousSeasonRating - START_RATING) * SEASON_CARRY);
}

/** Elo's logistic curve: the share of the pair `a` is expected to take. */
export function expectedScore(a: number, b: number): number {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

/** Bot seats carry this synthetic id instead of a real users.id — the same
 *  convention scoring and history already use (server/onlineGameLogic.ts). */
const BOT_ID_PREFIX = "bot:";

/**
 * The human seats of a finished hand, renumbered 1..n among themselves.
 *
 * Renumbering is the part that is easy to get wrong: with a bot finishing
 * second of four, the humans placed 1st, 3rd and 4th, and rating them on those
 * numbers would treat a three-player result as if two seats were missing —
 * `actual` is derived from `n - placement`, so a placement above `n` goes
 * negative. Among the people being rated, that third place *is* second.
 */
export function ratedFinishers(
  seatResults: { userId: string; placement: number }[]
): { userId: string; placement: number }[] {
  return seatResults
    .filter((r) => !r.userId.startsWith(BOT_ID_PREFIX))
    .sort((a, b) => a.placement - b.placement)
    .map((r, i) => ({ userId: r.userId, placement: i + 1 }));
}

export interface RatedSeat {
  userId: string;
  rating: number;
  games: number;
  /** 1 = won the hand. Distinct per seat; the engine never ties placements. */
  placement: number;
}

/**
 * The rating change for every seat in one manche: `n(n-1)/2` pairwise results,
 * actual and expected share each normalised to sum to 1. At `n = 2` it reduces
 * to textbook Elo.
 *
 * **Conservation:** one K across the table makes the deltas sum to exactly
 * zero, and the rounding below is what keeps that exact. Mixed K — a
 * provisional account among veterans — cannot sum to zero, which is what a
 * provisional period is. Both pinned by tests/rating.test.ts.
 */
export function ratingDeltas(seats: RatedSeat[]): Map<string, number> {
  const out = new Map<string, number>();
  const n = seats.length;
  if (n < 2) return out;

  const pairs = (n * (n - 1)) / 2;

  const exact = seats.map((seat) => {
    const actual = (n - seat.placement) / pairs;
    let expected = 0;
    for (const other of seats) {
      if (other.userId === seat.userId) continue;
      expected += expectedScore(seat.rating, other.rating);
    }
    const value = kFactor(seat.games) * (n - 1) * (actual - expected / pairs);
    return { userId: seat.userId, value, whole: Math.floor(value), frac: value - Math.floor(value) };
  });

  // Rounding each delta on its own would move the table's total, so a hand
  // could leak a point into or out of the ladder through arithmetic alone.
  // Largest remainder makes the rounded total match the exact one — which is
  // zero whenever every seat shares a K. Ties break on id, so the result never
  // depends on seat order.
  const target = Math.round(exact.reduce((total, e) => total + e.value, 0));
  let residual = target - exact.reduce((total, e) => total + e.whole, 0);
  for (const item of [...exact].sort((a, b) => b.frac - a.frac || (a.userId < b.userId ? -1 : 1))) {
    if (residual <= 0) break;
    item.whole += 1;
    residual -= 1;
  }

  for (const e of exact) out.set(e.userId, e.whole);
  return out;
}
