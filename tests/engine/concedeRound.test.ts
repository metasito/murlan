import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { concedeRound } from "../../lib/game/gameEngine.ts";
import { card as c, seat, state as makeState } from "../support/game.ts";

describe("concedeRound", () => {
  // Seat 1 already went out first; seats 0, 2 and 3 still hold 3, 1 and 1 cards.
  const before = () =>
    makeState({
      players: [
        seat(0, [c("4", "hearts"), c("5", "hearts"), c("6", "hearts")]),
        seat(1, [], { finishPosition: 1 }),
        seat(2, [c("7", "hearts")]),
        seat(3, [c("8", "hearts")]),
      ],
      finishingOrder: ["p1"],
    });

  test("the winner seat goes next, then the rest by fewest cards, seat order breaking ties", () => {
    const after = concedeRound(before(), 0);
    assert.deepEqual(after.finishingOrder, ["p1", "p0", "p2", "p3"]);
    assert.deepEqual(after.players.map((p) => p.finishPosition), [2, 1, 3, 4]);
    assert.equal(after.roundOver, true);
  });

  test("with no winner seat, every seat still holding cards is placed by fewest cards", () => {
    assert.deepEqual(concedeRound(before()).finishingOrder, ["p1", "p2", "p3", "p0"]);
  });

  test("a seat that already went out keeps its place even when named the winner", () => {
    assert.deepEqual(concedeRound(before(), 1).finishingOrder, ["p1", "p2", "p3", "p0"]);
  });

  test("returns a new state and leaves the one it was handed untouched", () => {
    const state = before();
    const snapshot = structuredClone(state);
    const after = concedeRound(state, 0);
    assert.notEqual(after, state);
    assert.deepEqual(state, snapshot);
  });
});
