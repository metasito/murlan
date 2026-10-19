import { test } from "node:test";
import assert from "node:assert/strict";
import { assertFresh } from "../e2e/helpers/freshTable.ts";
import { freshHandFloor } from "../../lib/game/gameEngine.ts";

const seats = (...counts: string[]) =>
  ["top-seat", "side-seat-left", "side-seat-right"].slice(0, counts.length).map((testId, i) => ({ testId, count: counts[i] }));

test("a freshly dealt table passes, at every seat count", () => {
  for (const n of [2, 3, 4]) {
    const floor = String(freshHandFloor(n));
    assert.doesNotThrow(() => assertFresh(seats(...Array.from({ length: n - 1 }, () => floor)), n));
  }
});

test("a seat below the fresh floor refuses the table, naming the seat", () => {
  const floor = String(freshHandFloor(4));
  assert.throws(() => assertFresh(seats("0", floor, floor), 4), /top-seat seat already holds 0 card\(s\).*already been played into/);
});

test("the floor is the table's own seat count's", () => {
  assert.ok(freshHandFloor(2) > freshHandFloor(4));
  assert.throws(() => assertFresh(seats(String(freshHandFloor(4))), 2), /already been played into/);
});

test("a count that is not a whole number refuses the table rather than passing it", () => {
  for (const unread of ["?", "", " ", "7 carte", "NaN", "13.5", "-1", "1e1"]) {
    assert.throws(() => assertFresh(seats(unread), 2), /cannot read seat count/, JSON.stringify(unread));
  }
});

test("a count with surrounding whitespace still reads", () => {
  assert.doesNotThrow(() => assertFresh(seats(` ${freshHandFloor(2)}\n`), 2));
});

test("a table showing fewer opponent seats than it seats is refused, so an empty read cannot pass", () => {
  const floor = String(freshHandFloor(4));
  assert.throws(() => assertFresh([], 4), /read 0 opponent seat\(s\) on a 4-seat table/);
  assert.throws(() => assertFresh(seats(floor, floor), 4), /read 2 opponent seat\(s\) on a 4-seat table/);
});
