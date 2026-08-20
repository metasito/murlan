import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { standings } from "../lib/standings.ts";

const row = (name: string, total: number, points: number, finishedAt: number) => ({
  name,
  total,
  points,
  finishedAt,
});

describe("standings", () => {
  it("orders by match points, not by the manche just played", () => {
    // The manche finished shtiz7, rotonmeta, KenziGmbH — but KenziGmbH has
    // carried more points into it than rotonmeta.
    const ordered = standings([
      row("shtiz7", 14, 2, 0),
      row("rotonmeta", 3, 1, 1),
      row("KenziGmbH", 4, 0, 2),
    ]);
    assert.deepEqual(ordered.map((r) => r.name), ["shtiz7", "KenziGmbH", "rotonmeta"]);
  });

  it("breaks a tie on points with the manche just played", () => {
    const ordered = standings([
      row("late", 7, 0, 2),
      row("early", 7, 2, 0),
    ]);
    assert.deepEqual(ordered.map((r) => r.name), ["early", "late"]);
  });

  it("leaves the caller's array alone", () => {
    const input = [row("b", 1, 0, 0), row("a", 9, 0, 1)];
    standings(input);
    assert.deepEqual(input.map((r) => r.name), ["b", "a"]);
  });

  // The floor: the property every caller renders against. Whatever the input,
  // the totals coming out never climb — a screen listing these rows in order
  // can never print a bigger number below a smaller one.
  it("never returns a row whose total exceeds the row above it", () => {
    const shuffled = [
      row("a", 0, 0, 3),
      row("b", 12, 2, 0),
      row("c", 4, 0, 2),
      row("d", 4, 1, 1),
    ];
    const totals = standings(shuffled).map((r) => r.total);
    for (let i = 1; i < totals.length; i++) {
      assert.ok(totals[i] <= totals[i - 1], `${totals[i]} follows ${totals[i - 1]}`);
    }
  });

  it("holds that property on an empty table and a single seat", () => {
    assert.deepEqual(standings([]), []);
    assert.deepEqual(standings([row("solo", 0, 0, 0)]).map((r) => r.name), ["solo"]);
  });
});
