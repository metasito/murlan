import { test, describe } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore — see tests/helpers.ts
import {
  c,
  createDeck,
  dealCards,
  findStartingPlayer,
  initializeGame,
  j,
  makePlayer,
  shuffleDeck,
  type Card,
} from "./helpers.ts";

const ids = (cards: Card[]) => cards.map((card) => card.id);

describe("deck", () => {
  test("is 52 cards plus 2 distinguishable jokers", () => {
    const deck = createDeck();
    assert.equal(deck.length, 54);
    assert.equal(deck.filter((card) => card.isJoker).length, 2);
    assert.equal(new Set(ids(deck)).size, 54, "every card id is unique");
    assert.ok(deck.some((card) => card.rank === "joker_bw"));
    assert.ok(deck.some((card) => card.rank === "joker_colored"));
  });

  test("shuffle is a permutation, never a mutation of the input", () => {
    const deck = createDeck();
    const before = ids(deck);
    const shuffled = shuffleDeck(deck);
    assert.deepEqual(ids(deck), before, "input deck is untouched");
    assert.deepEqual(ids(shuffled).sort(), [...before].sort());
  });

  test("shuffle actually shuffles and is not stuck on one ordering", () => {
    const orderings = new Set<string>();
    for (let i = 0; i < 20; i++) orderings.add(ids(shuffleDeck(createDeck())).join(","));
    assert.ok(orderings.size > 15, "20 shuffles should produce distinct orderings");
  });

  test("shuffle covers the whole range (no dead first position)", () => {
    const firsts = new Set<string>();
    for (let i = 0; i < 300; i++) firsts.add(shuffleDeck(createDeck())[0].id);
    assert.ok(firsts.size > 30, `only ${firsts.size} distinct first cards in 300 shuffles`);
  });
});

describe("the deal (defect 3) — the whole deck goes out", () => {
  const cases: Array<[number, number[]]> = [
    [4, [14, 14, 13, 13]],
    [3, [18, 18, 18]],
    [2, [27, 27]],
  ];

  for (const [playerCount, expected] of cases) {
    test(`${playerCount} players receive ${expected.join("/")}`, () => {
      const { hands, excluded } = dealCards(playerCount);
      assert.deepEqual(hands.map((h) => h.length), expected);
      assert.equal(excluded.length, 0, "nothing is ever excluded");
      const all = hands.flat();
      assert.equal(all.length, 54);
      assert.equal(new Set(ids(all)).size, 54, "no card is dealt twice");
    });
  }

  test("both jokers and the 3 of spades are always dealt", () => {
    for (let i = 0; i < 200; i++) {
      for (const playerCount of [2, 3, 4]) {
        const all = dealCards(playerCount).hands.flat();
        assert.ok(all.some((card) => card.rank === "joker_bw"));
        assert.ok(all.some((card) => card.rank === "joker_colored"));
        assert.ok(all.some((card) => card.rank === "3" && card.suit === "spades"));
      }
    }
  });

  test("a degenerate player count cannot crash", () => {
    assert.deepEqual(dealCards(0), { hands: [], excluded: [] });
  });
});

describe("findStartingPlayer (defect 4)", () => {
  test("finds the holder of the 3 of spades", () => {
    const players = [
      makePlayer("p0", [c("4", "spades"), c("K", "hearts")]),
      makePlayer("p1", [c("3", "hearts"), c("3", "spades")]),
      makePlayer("p2", [c("2", "spades")]),
    ];
    const { playerIdx, startCard } = findStartingPlayer(players);
    assert.equal(playerIdx, 1);
    assert.equal(startCard.id, "3_spades");
  });

  test("does not fall back to a lower spade when the 3 of spades exists elsewhere", () => {
    const players = [
      makePlayer("p0", [c("4", "spades")]),
      makePlayer("p1", [c("3", "spades")]),
    ];
    assert.equal(findStartingPlayer(players).playerIdx, 1);
  });

  test("defensive fallback: no 3 of spades — lowest card held wins, no crash", () => {
    const players = [
      makePlayer("p0", [c("K", "hearts"), c("9", "clubs")]),
      makePlayer("p1", [c("5", "diamonds"), j("colored")]),
    ];
    const { playerIdx, startCard } = findStartingPlayer(players);
    assert.equal(playerIdx, 1);
    assert.equal(startCard.id, "5_diamonds");
  });

  test("defensive fallback: every hand empty — returns a card instead of crashing", () => {
    const players = [makePlayer("p0", []), makePlayer("p1", [])];
    const { playerIdx, startCard } = findStartingPlayer(players);
    assert.equal(playerIdx, 0);
    assert.ok(startCard, "must not be undefined");
  });

  test("a real 4-player game always opens on the 3 of spades", () => {
    const setup = [0, 1, 2, 3].map((i) => ({ name: `p${i}`, type: "human" as const }));
    for (let i = 0; i < 100; i++) {
      const state = initializeGame(setup, "free_for_all");
      assert.equal(state.startCard?.id, "3_spades");
      assert.ok(
        state.players[state.currentTurnIndex].hand.some((card) => card.id === "3_spades"),
        "the opener must hold the start card"
      );
      assert.deepEqual(state.players.map((p) => p.hand.length), [14, 14, 13, 13]);
    }
  });
});
