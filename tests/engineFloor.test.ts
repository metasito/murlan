// tests/engineFloor.test.ts — the engine refuses a move that cannot happen.
//
// `processPlay` used to strip exactly the ids it was handed. Every caller gates
// first — the server by seat, the offline context before it commits, and an AI
// play is legal by construction — so the hole never opened. A caller that
// forgot would have corrupted the state silently rather than been refused, and
// two call sites re-implement a legality check the engine already owns.
//
// A floor is only a floor if it also lets the legal case through, so the null
// case is here too: leading a fresh round, where there is nothing to beat.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildCombination,
  c,
  makePlayer,
  makeState,
  processPlay,
  type Card,
} from "./helpers.ts";

const combo = (cards: Card[]) => buildCombination(cards)!;

const table = (over: Parameters<typeof makeState>[1] = {}) =>
  makeState(
    [
      makePlayer("p0", [c("5", "spades"), c("6", "spades"), c("K", "hearts")]),
      makePlayer("p1", [c("9", "clubs"), c("10", "clubs")]),
    ],
    { currentTurnIndex: 0, ...over }
  );

describe("the engine's floor under a play", () => {
  test("refuses cards the acting hand does not hold", () => {
    assert.throws(
      () => processPlay(table(), combo([c("A", "diamonds")])),
      /does not hold A_diamonds/
    );
  });

  test("refuses a hand that holds only some of what it played", () => {
    assert.throws(
      () => processPlay(table(), combo([c("5", "spades"), c("5", "hearts")])),
      /does not hold 5_hearts/
    );
  });

  test("refuses a combination that cannot beat the table", () => {
    const state = table({ lastPlayedCombination: combo([c("Q", "diamonds")]), lastPlayedBy: 1 });
    assert.throws(() => processPlay(state, combo([c("5", "spades")])), /does not beat the table/);
  });

  test("refuses a play of nothing", () => {
    assert.throws(() => processPlay(table(), { type: "single", cards: [], strength: 0 }), /played nothing/);
  });

  // The null case. Without it every assertion above would also hold on an
  // engine that refused every play there is.
  test("lets a fresh round be led, where there is nothing to beat", () => {
    const next = processPlay(table(), combo([c("5", "spades")]));
    assert.deepEqual(
      next.players[0].hand.map((card) => card.id),
      ["6_spades", "K_hearts"]
    );
    assert.equal(next.lastPlayedCombination?.type, "single");
  });

  test("lets a play through that does beat the table", () => {
    const state = table({ lastPlayedCombination: combo([c("4", "diamonds")]), lastPlayedBy: 1 });
    const next = processPlay(state, combo([c("K", "hearts")]));
    assert.equal(next.lastPlayedBy, 0);
    assert.equal(next.lastPlayedCombination?.cards[0].id, "K_hearts");
  });

  // A caller can hold every card claimed and still lie about what shape they
  // form — three unrelated singles claimed as a bomb, holding the table's
  // real bomb comparison hostage to a made-up strength. `canPlay` compares
  // only what it is told; nothing upstream of it re-derives the shape from
  // the cards unless this does.
  test("refuses a combination whose claimed shape its own cards do not form", () => {
    const state = table({
      lastPlayedCombination: {
        type: "bomb",
        cards: [c("2", "spades"), c("2", "hearts"), c("2", "clubs"), c("2", "diamonds")],
        strength: 99,
      },
      lastPlayedBy: 1,
    });
    const fabricated = {
      type: "bomb" as const,
      cards: [c("5", "spades"), c("6", "spades"), c("K", "hearts")],
      strength: 999,
    };
    assert.throws(() => processPlay(state, fabricated), /is not a bomb/);
  });

  test("refuses an opening play that skips the mandatory 3♠", () => {
    const opening = table({
      firstPlayMade: false,
      startCard: c("3", "spades"),
      players: [
        makePlayer("p0", [c("3", "spades"), c("5", "spades"), c("K", "hearts")]),
        makePlayer("p1", [c("9", "clubs"), c("10", "clubs")]),
      ],
    });
    assert.throws(
      () => processPlay(opening, combo([c("5", "spades")])),
      /must open with 3_spades/
    );
  });

  test("lets the opening play through once it includes the start card", () => {
    const opening = table({
      firstPlayMade: false,
      startCard: c("3", "spades"),
      players: [
        makePlayer("p0", [c("3", "spades"), c("5", "spades"), c("K", "hearts")]),
        makePlayer("p1", [c("9", "clubs"), c("10", "clubs")]),
      ],
    });
    const next = processPlay(opening, combo([c("3", "spades")]));
    assert.equal(next.firstPlayMade, true);
    assert.equal(next.lastPlayedCombination?.cards[0].id, "3_spades");
  });
});
