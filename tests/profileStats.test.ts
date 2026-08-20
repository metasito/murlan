// tests/profileStats.test.ts — the trends the profile draws from a player's
// finished matches.
//
// The case that ships broken is the small one: a player with three matches, or
// none. Every shape here has to say something honest at that size rather than
// produce an empty chart with axes.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  recentForm,
  placementDistribution,
  byPlayerCount,
  RECENT_FORM_LIMIT,
  type MatchRecord,
} from "../lib/profileStats.ts";

/** `n` days ago, so ordering is explicit rather than incidental. */
const match = (daysAgo: number, placement: number, playerCount = 4): MatchRecord => ({
  finishedAt: new Date(Date.UTC(2026, 7, 20 - daysAgo)).toISOString(),
  placement,
  playerCount,
});

describe("recent form", () => {
  test("reads newest first, whatever order the rows arrived in", () => {
    const history = [match(3, 4), match(1, 1), match(2, 2)];

    assert.deepEqual(recentForm(history), [1, 2, 4]);
  });

  test("is bounded, so a long history cannot grow the strip", () => {
    const history = Array.from({ length: 40 }, (_, i) => match(i, (i % 4) + 1));

    assert.equal(recentForm(history).length, RECENT_FORM_LIMIT);
    assert.equal(recentForm(history, 3).length, 3);
  });

  test("three matches produce three results, not a padded row", () => {
    assert.deepEqual(recentForm([match(1, 1), match(2, 3), match(3, 2)]), [1, 3, 2]);
  });

  test("no matches produce nothing to draw", () => {
    assert.deepEqual(recentForm([]), []);
  });
});

describe("placement distribution", () => {
  test("counts each placement and its share of the matches counted", () => {
    const history = [match(1, 1), match(2, 1), match(3, 2), match(4, 4)];

    assert.deepEqual(placementDistribution(history), [
      { placement: 1, played: 2, share: 0.5 },
      { placement: 2, played: 1, share: 0.25 },
      { placement: 4, played: 1, share: 0.25 },
    ]);
  });

  test("a placement never reached has no row, rather than a zero one", () => {
    const slices = placementDistribution([match(1, 1), match(2, 1)]);

    assert.deepEqual(slices.map((s) => s.placement), [1]);
  });

  test("no matches distribute nothing, and divide by nothing", () => {
    assert.deepEqual(placementDistribution([]), []);
  });
});

describe("by player count", () => {
  test("splits results by table size, because a player can be strong at one", () => {
    const history = [
      match(1, 1, 3),
      match(2, 2, 3),
      match(3, 4, 4),
      match(4, 1, 4),
      match(5, 3, 4),
    ];

    assert.deepEqual(byPlayerCount(history), [
      { playerCount: 3, played: 2, won: 1, averagePlacement: 1.5 },
      { playerCount: 4, played: 3, won: 1, averagePlacement: 2.7 },
    ]);
  });

  test("a single match at a table size is reported as one match", () => {
    assert.deepEqual(byPlayerCount([match(1, 2, 2)]), [
      { playerCount: 2, played: 1, won: 0, averagePlacement: 2 },
    ]);
  });

  test("no matches split into nothing", () => {
    assert.deepEqual(byPlayerCount([]), []);
  });
});
