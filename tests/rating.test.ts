// tests/rating.test.ts — the ladder's arithmetic, including the property that
// stands in for an anti-farming mechanism: a fixed pair asymptotes on its own.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROVISIONAL_GAMES,
  START_RATING,
  expectedScore,
  formatSeason,
  kFactor,
  ratedFinishers,
  ratingDeltas,
  seasonKey,
  seedRating,
  type RatedSeat,
} from "../lib/rating.ts";

const seat = (userId: string, placement: number, rating = START_RATING, games = 30): RatedSeat => ({
  userId,
  rating,
  games,
  placement,
});

const sum = (deltas: Map<string, number>) => [...deltas.values()].reduce((a, b) => a + b, 0);

test("equal players have an even expectation, and the pair sums to one", () => {
  assert.equal(expectedScore(1000, 1000), 0.5);
  assert.ok(Math.abs(expectedScore(1200, 1000) + expectedScore(1000, 1200) - 1) < 1e-12);
  assert.ok(expectedScore(1400, 1000) > 0.9, "400 points is the classic 10:1 gap");
});

test("a duel between equals is textbook Elo", () => {
  const deltas = ratingDeltas([seat("a", 1), seat("b", 2)]);
  // K/2 at even odds — the standard result, which is what makes the
  // n-player generalisation trustworthy.
  assert.equal(deltas.get("a"), kFactor(30) / 2);
  assert.equal(deltas.get("b"), -kFactor(30) / 2);
});

/** Deterministic sequence, so a failure here is always reproducible. */
function seeded(seed: number) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

// Exact, not approximate: deltas are integers, and rounding each on its own
// would let a hand leak a point into or out of the ladder through arithmetic.
test("a table on one K conserves rating exactly, whatever the field", () => {
  const next = seeded(12345);
  for (let trial = 0; trial < 500; trial++) {
    const n = 2 + Math.floor(next() * 3);
    const seats = Array.from({ length: n }, (_, i) =>
      seat(`p${i}`, i + 1, Math.round(400 + next() * 1600), 40)
    );
    assert.equal(sum(ratingDeltas(seats)), 0, `n=${n} trial ${trial}`);
  }
});

// Mixed records cannot conserve exactly — paying a provisional account faster
// than its opponents lose is what a provisional period *is*. What must hold is
// that the leak stays bounded per hand rather than compounding, and the bound
// falls straight out of the formula: the spread between the fastest and
// slowest K, once per pairing a seat takes part in.
test("mixed records leak no more than the K spread allows", () => {
  const spread = kFactor(0) - kFactor(Number.MAX_SAFE_INTEGER);
  const next = seeded(999);
  for (let trial = 0; trial < 500; trial++) {
    const n = 2 + Math.floor(next() * 3);
    const seats = Array.from({ length: n }, (_, i) =>
      seat(`p${i}`, i + 1, Math.round(400 + next() * 1600), Math.floor(next() * 60))
    );
    const leaked = sum(ratingDeltas(seats));
    assert.ok(
      Math.abs(leaked) <= (n - 1) * spread,
      `n=${n} trial ${trial} leaked ${leaked}, bound ${(n - 1) * spread}`
    );
  }
});

test("seat order never changes the outcome", () => {
  const seats = [seat("a", 1, 1200, 3), seat("b", 2, 900, 40), seat("c", 3, 1500, 12)];
  const forward = ratingDeltas(seats);
  const backward = ratingDeltas([...seats].reverse());
  for (const [id, delta] of forward) assert.equal(backward.get(id), delta, id);
});

test("placement orders the deltas, best to worst", () => {
  const deltas = ratingDeltas([seat("a", 1), seat("b", 2), seat("c", 3), seat("d", 4)]);
  const ordered = ["a", "b", "c", "d"].map((id) => deltas.get(id)!);
  for (let i = 1; i < ordered.length; i++) {
    assert.ok(ordered[i - 1] > ordered[i], `${ordered[i - 1]} should beat ${ordered[i]}`);
  }
});

test("beating a much stronger field pays more than beating a weaker one", () => {
  const vsStrong = ratingDeltas([seat("me", 1, 1000), seat("x", 2, 1600), seat("y", 3, 1600)]);
  const vsWeak = ratingDeltas([seat("me", 1, 1000), seat("x", 2, 400), seat("y", 3, 400)]);
  assert.ok(vsStrong.get("me")! > vsWeak.get("me")!);
});

test("a hand with fewer than two rated seats is not a contest", () => {
  assert.equal(ratingDeltas([]).size, 0);
  assert.equal(ratingDeltas([seat("a", 1)]).size, 0);
});

test("K falls as a record grows, and never rises again", () => {
  const ks = [0, 4, 9, 10, 29, 30, 200].map(kFactor);
  for (let i = 1; i < ks.length; i++) assert.ok(ks[i] <= ks[i - 1]);
  assert.ok(kFactor(0) > kFactor(200));
});

// The anti-farming property. Two accounts where one always wins do not produce
// unbounded rating: the loser sinks, the winner's expected score approaches 1,
// and the payout approaches zero. This is what stands in place of a mechanism.
test("a fixed pair farming each other asymptotes", () => {
  let winner = START_RATING;
  let loser = START_RATING;
  const gainOver = (rounds: number) => {
    const before = winner;
    for (let i = 0; i < rounds; i++) {
      const deltas = ratingDeltas([
        { userId: "w", rating: winner, games: 100, placement: 1 },
        { userId: "l", rating: loser, games: 100, placement: 2 },
      ]);
      winner += deltas.get("w")!;
      loser += deltas.get("l")!;
    }
    return winner - before;
  };

  const first = gainOver(100);
  const second = gainOver(100);
  const third = gainOver(100);

  assert.ok(first > 0, "the farm works at first, as Elo intends");
  assert.ok(second < first, "and pays less the second hundred times");
  assert.equal(third, 0, "and then stops paying at all");
  assert.ok(winner - START_RATING < 400, `the whole farm is worth ${winner - START_RATING} points, once`);
});

test("a season is the calendar month, in UTC", () => {
  assert.equal(seasonKey(new Date("2026-08-16T22:00:00.000Z")), "2026-08");
  assert.equal(seasonKey(new Date("2026-01-01T00:00:00.000Z")), "2026-01");
  // A local-time reading would put this in September for anyone east of UTC.
  assert.equal(seasonKey(new Date("2026-08-31T23:59:59.999Z")), "2026-08");
  assert.equal(seasonKey(new Date("2026-09-01T00:00:00.000Z")), "2026-09");
});

test("a new season keeps half the distance from the mean", () => {
  assert.equal(seedRating(null), START_RATING);
  assert.equal(seedRating(START_RATING), START_RATING);
  assert.equal(seedRating(1400), 1200);
  assert.equal(seedRating(600), 800);
  // Repeated seasons of inactivity converge on the mean rather than overshooting it.
  let r = 1800;
  for (let i = 0; i < 20; i++) r = seedRating(r);
  assert.equal(r, START_RATING);
});

test("the provisional gate is smaller than the window K treats as new", () => {
  assert.ok(PROVISIONAL_GAMES > 0);
  assert.equal(kFactor(PROVISIONAL_GAMES), kFactor(0), "still provisional-speed at the gate");
});

test("bots are dropped and the humans renumbered among themselves", () => {
  // A bot took second of four; the humans placed 1st, 3rd and 4th.
  const rated = ratedFinishers([
    { userId: "u1", placement: 1 },
    { userId: "bot:2", placement: 2 },
    { userId: "u2", placement: 3 },
    { userId: "u3", placement: 4 },
  ]);
  assert.deepEqual(rated, [
    { userId: "u1", placement: 1 },
    { userId: "u2", placement: 2 },
    { userId: "u3", placement: 3 },
  ]);
});

// Renumbering is what keeps `actual` inside [0, 1]: a placement above the
// number of rated seats would make it negative and invert the result.
test("renumbered placements always produce a well-formed contest", () => {
  const rated = ratedFinishers([
    { userId: "bot:0", placement: 1 },
    { userId: "u1", placement: 2 },
    { userId: "bot:2", placement: 3 },
    { userId: "u2", placement: 4 },
  ]);
  const deltas = ratingDeltas(rated.map((r) => seat(r.userId, r.placement)));
  assert.equal(deltas.get("u1"), kFactor(30) / 2, "the better human wins the pair outright");
  assert.equal(sum(deltas), 0);
});

test("a table of one human plus bots is not a contest", () => {
  assert.equal(ratedFinishers([{ userId: "u1", placement: 1 }, { userId: "bot:1", placement: 2 }]).length, 1);
});

// The season key is data — half the user_ratings primary key, and lexically
// sortable, which is what makes "the season before this one" a plain ORDER BY.
// Only its presentation changes.
test("a season reads as a month and a year, in the reader's language", () => {
  const it = (key: string) => ({ "month.8": "Agosto", "month.1": "Gennaio" })[key] ?? key;
  assert.equal(formatSeason("2026-08", it as never), "Agosto 2026");
  assert.equal(formatSeason("2026-01", it as never), "Gennaio 2026");
});

// Mangling an unexpected key into a plausible-looking month would be worse than
// showing it raw: the only way to get one is a future change to seasonKey, and
// an odd label is a better failure than a confidently wrong one.
test("a key that is not YYYY-MM is shown as it is, not guessed at", () => {
  const t = (key: string) => `T(${key})`;
  for (const odd of ["2026", "2026-13", "2026-00", "", "next-season", "26-08"]) {
    assert.equal(formatSeason(odd, t as never), odd, odd);
  }
});

test("the formatter asks for the month the key names", () => {
  const asked: string[] = [];
  formatSeason("2026-12", ((k: string) => {
    asked.push(k);
    return "Dicembre";
  }) as never);
  assert.deepEqual(asked, ["month.12"]);
});
