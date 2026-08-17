import { test, describe } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore — see tests/helpers.ts
import {
  buildCombination,
  c,
  cardStrength,
  canPlay,
  getCombinationType,
  getRankStrength,
  j,
} from "./helpers.ts";

describe("card strength order", () => {
  test("3 < ... < A < 2 < black joker < red joker", () => {
    const order = [
      "3", "4", "5", "6", "7", "8", "9", "10",
      "J", "Q", "K", "A", "2", "joker_bw", "joker_colored",
    ] as const;
    for (let i = 1; i < order.length; i++) {
      assert.ok(
        getRankStrength(order[i]) > getRankStrength(order[i - 1]),
        `${order[i]} must outrank ${order[i - 1]}`
      );
    }
  });

  test("suit does not affect strength", () => {
    assert.equal(cardStrength(c("K", "spades")), cardStrength(c("K", "clubs")));
  });
});

describe("combination typing", () => {
  test("single", () => {
    assert.equal(getCombinationType([c("7", "hearts")]), "single");
    assert.equal(getCombinationType([j("colored")]), "single");
  });

  test("pair requires matching ranks", () => {
    assert.equal(getCombinationType([c("7", "hearts"), c("7", "clubs")]), "pair");
    assert.equal(getCombinationType([c("7", "hearts"), c("8", "clubs")]), null);
  });

  test("triple requires three matching ranks", () => {
    assert.equal(
      getCombinationType([c("9", "hearts"), c("9", "clubs"), c("9", "spades")]),
      "triple"
    );
    assert.equal(
      getCombinationType([c("9", "hearts"), c("9", "clubs"), c("8", "spades")]),
      null
    );
  });

  test("bomb is exactly four of a kind", () => {
    assert.equal(
      getCombinationType([
        c("5", "hearts"), c("5", "clubs"), c("5", "spades"), c("5", "diamonds"),
      ]),
      "bomb"
    );
    // Four cards that are not four of a kind are not a valid play at all
    assert.equal(
      getCombinationType([
        c("5", "hearts"), c("6", "clubs"), c("7", "spades"), c("8", "diamonds"),
      ]),
      null
    );
  });

  test("jokers are singles only — never in pairs, triples, bombs or straights", () => {
    assert.equal(getCombinationType([j("bw"), j("colored")]), null);
    assert.equal(getCombinationType([j("bw"), c("2", "hearts")]), null);
    assert.equal(
      getCombinationType([c("2", "hearts"), c("2", "clubs"), j("bw")]),
      null
    );
    assert.equal(
      getCombinationType([
        c("3", "hearts"), c("4", "clubs"), c("5", "spades"), c("6", "diamonds"), j("bw"),
      ]),
      null
    );
    assert.equal(
      getCombinationType([
        c("2", "hearts"), c("2", "clubs"), c("2", "spades"), j("bw"),
      ]),
      null
    );
  });

  test("royal straight is a same-suit straight", () => {
    assert.equal(
      getCombinationType([
        c("3", "spades"), c("4", "spades"), c("5", "spades"),
        c("6", "spades"), c("7", "spades"),
      ]),
      "royal_straight"
    );
    assert.equal(
      getCombinationType([
        c("3", "spades"), c("4", "spades"), c("5", "spades"),
        c("6", "spades"), c("7", "hearts"),
      ]),
      "straight"
    );
  });
});

describe("combination strength", () => {
  test("pair and triple strength is the shared rank", () => {
    const pair = buildCombination([c("Q", "hearts"), c("Q", "spades")]);
    assert.equal(pair?.strength, cardStrength(c("Q", "hearts")));
    const triple = buildCombination([
      c("4", "hearts"), c("4", "spades"), c("4", "clubs"),
    ]);
    assert.equal(triple?.strength, cardStrength(c("4", "hearts")));
  });

  test("straight strength is the top of the sequence, not the card ranking", () => {
    // 2 is low inside a straight: 2-3-4-5-6 tops out at 6, not at the 2.
    const low = buildCombination([
      c("2", "hearts"), c("3", "clubs"), c("4", "spades"),
      c("5", "diamonds"), c("6", "hearts"),
    ]);
    assert.equal(low?.type, "straight");
    assert.equal(low?.strength, 6);

    const high = buildCombination([
      c("10", "hearts"), c("J", "clubs"), c("Q", "spades"),
      c("K", "diamonds"), c("A", "hearts"),
    ]);
    assert.equal(high?.strength, 14);
  });
});

describe("beat hierarchy (canPlay)", () => {
  const pair7 = buildCombination([c("7", "hearts"), c("7", "clubs")])!;
  const pair8 = buildCombination([c("8", "hearts"), c("8", "clubs")])!;
  const pair7b = buildCombination([c("7", "spades"), c("7", "diamonds")])!;
  const bomb5 = buildCombination([
    c("5", "hearts"), c("5", "clubs"), c("5", "spades"), c("5", "diamonds"),
  ])!;
  const bomb9 = buildCombination([
    c("9", "hearts"), c("9", "clubs"), c("9", "spades"), c("9", "diamonds"),
  ])!;
  const straight5 = buildCombination([
    c("3", "hearts"), c("4", "clubs"), c("5", "spades"),
    c("6", "diamonds"), c("7", "hearts"),
  ])!;
  const straight6 = buildCombination([
    c("3", "hearts"), c("4", "clubs"), c("5", "spades"),
    c("6", "diamonds"), c("7", "hearts"), c("8", "clubs"),
  ])!;
  const royalLow = buildCombination([
    c("3", "spades"), c("4", "spades"), c("5", "spades"),
    c("6", "spades"), c("7", "spades"),
  ])!;
  const royalHigh = buildCombination([
    c("9", "hearts"), c("10", "hearts"), c("J", "hearts"),
    c("Q", "hearts"), c("K", "hearts"),
  ])!;

  test("anything can open a round", () => {
    assert.equal(canPlay(pair7, null), true);
  });

  test("higher same-type same-length wins; equal strength does not", () => {
    assert.equal(canPlay(pair8, pair7), true);
    assert.equal(canPlay(pair7, pair8), false);
    assert.equal(canPlay(pair7b, pair7), false, "same rank is not strictly higher");
  });

  test("straights must match card count", () => {
    assert.equal(canPlay(straight6, straight5), false);
    assert.equal(canPlay(straight5, straight6), false);
  });

  test("bombs beat everything except royal straights and higher bombs", () => {
    assert.equal(canPlay(bomb5, pair7), true);
    assert.equal(canPlay(bomb5, straight6), true);
    assert.equal(canPlay(bomb9, bomb5), true);
    assert.equal(canPlay(bomb5, bomb9), false);
    assert.equal(canPlay(bomb9, royalLow), false, "a bomb cannot beat a royal straight");
  });

  test("royal straight beats anything; only a longer-or-equal higher royal beats it", () => {
    assert.equal(canPlay(royalLow, bomb9), true);
    assert.equal(canPlay(royalLow, straight5), true);
    assert.equal(canPlay(royalHigh, royalLow), true);
    assert.equal(canPlay(royalLow, royalHigh), false);
  });

  test("normal plays cannot answer a bomb or a royal straight", () => {
    assert.equal(canPlay(pair8, bomb5), false);
    assert.equal(canPlay(straight5, royalLow), false);
  });
});
