import { test } from "node:test";
import assert from "node:assert/strict";
import { assertFresh } from "../e2e/helpers/freshTable.ts";
import { freshHandFloor } from "../../lib/game/gameEngine.ts";

const seats = (...counts: string[]) =>
  ["top-seat", "side-seat-left", "side-seat-right"].slice(0, counts.length).map((testId, i) => ({ testId, count: counts[i] }));

test("a freshly dealt table passes, at every seat count", () => {
  for (const n of [2, 3, 4]) {
    const floor = String(freshHandFloor(n));
    assert.doesNotThrow(() => assertFresh(seats(...Array.from({ length: n - 1 }, () => floor))));
  }
});

test("a seat below the fresh floor refuses the table, naming the seat", () => {
  const floor = String(freshHandFloor(4));
  assert.throws(() => assertFresh(seats("0", floor, floor)), /top-seat seat already holds 0 card\(s\).*already been played into/);
});

test("the floor follows the seats on screen, not a fixed count", () => {
  const fourSeatFloor = String(freshHandFloor(4));
  assert.ok(freshHandFloor(2) > freshHandFloor(4));
  assert.throws(() => assertFresh(seats(fourSeatFloor)), /already been played into/);
});

test("a count that is not a whole number refuses the table rather than passing it", () => {
  for (const unread of ["?", "", " ", "7 carte", "NaN", "13.5", "-1", "1e1"]) {
    assert.throws(() => assertFresh(seats(unread)), /cannot read seat count/, JSON.stringify(unread));
  }
});

test("a count with surrounding whitespace still reads", () => {
  assert.doesNotThrow(() => assertFresh(seats(` ${freshHandFloor(2)}\n`)));
});
