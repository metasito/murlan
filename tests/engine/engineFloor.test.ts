// tests/engine/engineFloor.test.ts — the engine refuses a move that cannot happen.
//
// Every move reaches the engine as data through `applyMove`, which reads the
// cards from the hand and derives their shape itself: a move that cannot happen
// is refused as a value, and the state is left as it was.
//
// A floor is only a floor if it also lets the legal case through, so the null
// case is here too: leading a fresh round, where there is nothing to beat.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { card as c, seat as makePlayer, state as makeState } from "../support/game.ts";
import { played, refusalOf } from "../support/moves.ts";
import { buildCombination, type Card, type GameState, type Move } from "../../lib/game/gameEngine.ts";

const combo = (cards: Card[]) => buildCombination(cards)!;
const play = (...cardIds: string[]): Move => ({ kind: "play", cardIds });

const table = (over: Parameters<typeof makeState>[0] = {}) =>
  makeState(
    { players: [
      makePlayer(0, [c("5", "spades"), c("6", "spades"), c("K", "hearts")]),
      makePlayer(1, [c("9", "clubs"), c("10", "clubs")]),
    ], currentTurnIndex: 0, ...over }
  );

/** The refusal, with the state checked untouched by it. */
function refused(state: GameState, move: Move) {
  const before = structuredClone(state);
  const code = refusalOf(state, move);
  assert.deepEqual(state, before, "a refused move changed the state");
  return code;
}

describe("the engine's floor under a play", () => {
  test("refuses cards the acting hand does not hold", () => {
    assert.equal(refused(table(), play("A_diamonds")), "notHeld");
  });

  test("refuses a hand that holds only some of what it played", () => {
    assert.equal(refused(table(), play("5_spades", "5_hearts")), "notHeld");
  });

  test("refuses a combination that cannot beat the table", () => {
    const state = table({ lastPlayedCombination: combo([c("Q", "diamonds")]), lastPlayedBy: 1 });
    assert.equal(refused(state, play("5_spades")), "tooLow");
  });

  test("refuses a play of nothing", () => {
    assert.equal(refused(table(), play()), "notACombination");
  });

  // The null case. Without it every assertion above would also hold on an
  // engine that refused every play there is.
  test("lets a fresh round be led, where there is nothing to beat", () => {
    const next = played(table(), combo([c("5", "spades")]));
    assert.deepEqual(
      next.players[0].hand.map((card) => card.id),
      ["6_spades", "K_hearts"]
    );
    assert.equal(next.lastPlayedCombination?.type, "single");
  });

  test("lets a play through that does beat the table", () => {
    const state = table({ lastPlayedCombination: combo([c("4", "diamonds")]), lastPlayedBy: 1 });
    const next = played(state, combo([c("K", "hearts")]));
    assert.equal(next.lastPlayedBy, 0);
    assert.equal(next.lastPlayedCombination?.cards[0].id, "K_hearts");
  });

  // A move names cards, never a shape: three unrelated singles cannot be
  // passed off as the bomb that would beat this table.
  test("derives the shape from the cards played, not from the caller", () => {
    const state = table({
      lastPlayedCombination: {
        type: "bomb",
        cards: [c("2", "spades"), c("2", "hearts"), c("2", "clubs"), c("2", "diamonds")],
        strength: 99,
      },
      lastPlayedBy: 1,
    });
    assert.equal(refused(state, play("5_spades", "6_spades", "K_hearts")), "notACombination");
  });

  test("refuses an opening play that skips the mandatory 3♠", () => {
    const opening = table({
      openingCard: c("3", "spades"),
      players: [
        makePlayer(0, [c("3", "spades"), c("5", "spades"), c("K", "hearts")]),
        makePlayer(1, [c("9", "clubs"), c("10", "clubs")]),
      ],
    });
    assert.equal(refused(opening, play("5_spades")), "needsStartCard");
  });

  test("lets the opening play through once it includes the start card", () => {
    const opening = table({
      openingCard: c("3", "spades"),
      players: [
        makePlayer(0, [c("3", "spades"), c("5", "spades"), c("K", "hearts")]),
        makePlayer(1, [c("9", "clubs"), c("10", "clubs")]),
      ],
    });
    const next = played(opening, combo([c("3", "spades")]));
    assert.equal(next.openingCard, null);
    assert.equal(next.lastPlayedCombination?.cards[0].id, "3_spades");
  });
});

describe("a play that cannot happen", () => {
  const openExchange = { kind: "open", winnerIdx: 0, loserIdx: 1, cardFromLoser: c("K", "hearts") } as const;

  test("a card named four times is the one card, never a bomb", () => {
    const next = played(table(), {
      type: "bomb",
      cards: [c("5", "spades"), c("5", "spades"), c("5", "spades"), c("5", "spades")],
      strength: 5,
    });
    assert.equal(next.lastPlayedCombination?.type, "single");
    assert.deepEqual(next.players[0].hand.map((card) => card.id), ["6_spades", "K_hearts"]);
  });

  test("refuses any play while the exchange is open", () => {
    assert.equal(refused(table({ exchangePhase: openExchange }), play("5_spades")), "exchangeOpen");
  });

  test("a pass while the exchange is open changes nothing", () => {
    const state = table({
      exchangePhase: openExchange,
      lastPlayedCombination: combo([c("4", "hearts")]),
      lastPlayedBy: 1,
      passCount: 0,
    });
    assert.equal(refused(state, { kind: "pass" }), "exchangeOpen");
  });
});
