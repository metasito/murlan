// tests/engine/rating.test.ts — the ladder's arithmetic, including the property that
// stands in for an anti-farming mechanism: a fixed pair asymptotes on its own.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROVISIONAL_ROUNDS,
  START_RATING,
  expectedScore,
  formatSeason,
  kFactor,
  provisionalLeft,
  ratedFinishers,
  ratingDeltas,
  seasonKey,
  seedRating,
  type RatedSeat,
} from "../../lib/game/rating.ts";

const seat = (userId: string, placement: number, rating = START_RATING, rounds = 30): RatedSeat => ({
  userId,
  rating,
  rounds,
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
// would let a round leak a point into or out of the ladder through arithmetic.
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
// that the leak stays bounded per round rather than compounding, and the bound
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

test("a round with fewer than two rated seats is not a contest", () => {
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
        { userId: "w", rating: winner, rounds: 100, placement: 1 },
        { userId: "l", rating: loser, rounds: 100, placement: 2 },
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
  assert.ok(PROVISIONAL_ROUNDS > 0);
  assert.equal(kFactor(PROVISIONAL_ROUNDS), kFactor(0), "still provisional-speed at the gate");
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

test("provisionalLeft counts the rounds a record still needs, and is undefined once it is settled", () => {
  assert.equal(provisionalLeft({ rounds: 0 }), PROVISIONAL_ROUNDS);
  assert.equal(provisionalLeft({ rounds: PROVISIONAL_ROUNDS - 1 }), 1);
  assert.equal(provisionalLeft({ rounds: PROVISIONAL_ROUNDS }), undefined);
  assert.equal(provisionalLeft({ rounds: PROVISIONAL_ROUNDS + 7 }), undefined);
});

// docs/GAME-RULES.md has no ladder section; the K tiers are rating.ts's own convention.
// At equal ratings a duel's winner takes K/2, so the delta names the K in force.
test("a record's K steps down at exactly 2x the provisional gate and at 30 rounds", () => {
  const winnerGain = (rounds: number) =>
    ratingDeltas([seat("w", 1, START_RATING, rounds), seat("l", 2, START_RATING, rounds)]).get("w");
  assert.equal(winnerGain(PROVISIONAL_ROUNDS * 2 - 1), 20, "still new on round 9: K 40");
  assert.equal(winnerGain(PROVISIONAL_ROUNDS * 2), 12, "settling on round 10: K 24");
  assert.equal(winnerGain(29), 12, "K 24 through round 29");
  assert.equal(winnerGain(30), 8, "established from round 30: K 16");
});

// Elo's logistic curve: a 400-point gap is 10:1 odds, so 10/11 against 1/11.
test("a 400-point gap is ten to one, and the stronger side is the one expected to win", () => {
  assert.ok(Math.abs(expectedScore(1400, 1000) - 10 / 11) < 1e-12);
  assert.ok(Math.abs(expectedScore(1000, 1400) - 1 / 11) < 1e-12);
  // 200 points: 1 / (1 + 10^-0.5)
  assert.ok(Math.abs(expectedScore(1200, 1000) - 0.7597469266) < 1e-9);
});

test("humans are renumbered by finishing place whatever order the results arrive in", () => {
  const rated = ratedFinishers([
    { userId: "u3", placement: 4 },
    { userId: "bot:2", placement: 2 },
    { userId: "u2", placement: 3 },
    { userId: "u1", placement: 1 },
  ]);
  assert.deepEqual(rated, [
    { userId: "u1", placement: 1 },
    { userId: "u2", placement: 2 },
    { userId: "u3", placement: 3 },
  ]);
  const reversed = ratedFinishers([
    { userId: "u2", placement: 3 },
    { userId: "u1", placement: 1 },
  ]);
  assert.deepEqual(reversed, [
    { userId: "u1", placement: 1 },
    { userId: "u2", placement: 2 },
  ]);
});

test("a bot seat moves no human's rating", () => {
  const withBot = ratedFinishers([
    { userId: "u1", placement: 1 },
    { userId: "bot:1", placement: 2 },
    { userId: "u2", placement: 3 },
  ]);
  const alone = ratedFinishers([
    { userId: "u1", placement: 1 },
    { userId: "u2", placement: 2 },
  ]);
  assert.deepEqual(withBot, alone);
});

// Mixed K does not sum to zero: the exact total is the rounded sum of the exact deltas.
// "b" (1200, K 40) beats "a" (1000, K 16): exact +9.610 and -3.844, total +5.766, which rounds
// to 6. Floors give 9 and -4 (total 5), so one point is owed, to the larger remainder (.610).
test("a mixed-K table pays out the rounded exact total, the spare point to the largest remainder", () => {
  const deltas = ratingDeltas([seat("a", 2, 1000, 30), seat("b", 1, 1200, 0)]);
  assert.equal(deltas.get("b"), 10);
  assert.equal(deltas.get("a"), -4);
  assert.equal(sum(deltas), 6);
});

// 1100 vs 1100 vs 800, all K 24, placed 1-2-3: the two equal-rated seats' exact deltas are
// +10.416 and -5.584, the same remainder (.416), and one spare point is owed. It goes to the
// lower id, whichever seat that is.
test("a tie on the remainder goes to the lower user id, not to the better place", () => {
  const table = (first: string, second: string) =>
    ratingDeltas([
      seat(first, 1, 1100, 12),
      seat(second, 2, 1100, 12),
      seat("z", 3, 800, 12),
    ]);
  const lowerWon = table("a", "b");
  assert.equal(lowerWon.get("a"), 11);
  assert.equal(lowerWon.get("b"), -6);
  assert.equal(lowerWon.get("z"), -5);
  const lowerLost = table("b", "a");
  assert.equal(lowerLost.get("b"), 10);
  assert.equal(lowerLost.get("a"), -5);
  assert.equal(lowerLost.get("z"), -5);
  assert.equal(sum(lowerWon), 0);
  assert.equal(sum(lowerLost), 0);
});

test("only a key that is exactly YYYY-MM names a season", () => {
  const t = (key: string) => `T(${key})`;
  for (const odd of ["2026-08-16", "2026-08-16T10:00:00.000Z", "x2026-08", "12026-08", "2026-081", " 2026-08"]) {
    assert.equal(formatSeason(odd, t as never), odd, odd);
  }
});
