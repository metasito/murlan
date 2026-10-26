import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { card as c, joker as j } from "../support/game.ts";
import { beats } from "../support/moves.ts";
import { buildCombination, cardStrength, getCardDisplayRank, getRankStrength, getSuitSymbol, type Card } from "../../lib/game/gameEngine.ts";

/** The shape `cards` form, or null: what a play of them would be taken as. */
const typeOf = (cards: Card[]) => buildCombination(cards)?.type ?? null;

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
    assert.equal(typeOf([c("7", "hearts")]), "single");
    assert.equal(typeOf([j("colored")]), "single");
  });

  test("pair requires matching ranks", () => {
    assert.equal(typeOf([c("7", "hearts"), c("7", "clubs")]), "pair");
    assert.equal(typeOf([c("7", "hearts"), c("8", "clubs")]), null);
  });

  test("triple requires three matching ranks", () => {
    assert.equal(
      typeOf([c("9", "hearts"), c("9", "clubs"), c("9", "spades")]),
      "triple"
    );
    assert.equal(
      typeOf([c("9", "hearts"), c("9", "clubs"), c("8", "spades")]),
      null
    );
  });

  test("bomb is exactly four of a kind", () => {
    assert.equal(
      typeOf([
        c("5", "hearts"), c("5", "clubs"), c("5", "spades"), c("5", "diamonds"),
      ]),
      "bomb"
    );
    // Four cards that are not four of a kind are not a valid play at all
    assert.equal(
      typeOf([
        c("5", "hearts"), c("6", "clubs"), c("7", "spades"), c("8", "diamonds"),
      ]),
      null
    );
  });

  test("jokers are singles only — never in pairs, triples, bombs or straights", () => {
    assert.equal(typeOf([j("bw"), j("colored")]), null);
    assert.equal(typeOf([j("bw"), c("2", "hearts")]), null);
    assert.equal(
      typeOf([c("2", "hearts"), c("2", "clubs"), j("bw")]),
      null
    );
    assert.equal(
      typeOf([
        c("3", "hearts"), c("4", "clubs"), c("5", "spades"), c("6", "diamonds"), j("bw"),
      ]),
      null
    );
    assert.equal(
      typeOf([
        c("2", "hearts"), c("2", "clubs"), c("2", "spades"), j("bw"),
      ]),
      null
    );
  });

  test("royal straight is a same-suit straight", () => {
    assert.equal(
      typeOf([
        c("3", "spades"), c("4", "spades"), c("5", "spades"),
        c("6", "spades"), c("7", "spades"),
      ]),
      "royal_straight"
    );
    assert.equal(
      typeOf([
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

  test("straight strength is the top of the straight, not the card ranking", () => {
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

describe("beat hierarchy", () => {
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
    assert.equal(beats(pair7, null), true);
  });

  test("higher same-type same-length wins; equal strength does not", () => {
    assert.equal(beats(pair8, pair7), true);
    assert.equal(beats(pair7, pair8), false);
    assert.equal(beats(pair7b, pair7), false, "same rank is not strictly higher");
  });

  test("straights must match card count", () => {
    assert.equal(beats(straight6, straight5), false);
    assert.equal(beats(straight5, straight6), false);
  });

  test("bombs beat everything except royal straights and higher bombs", () => {
    assert.equal(beats(bomb5, pair7), true);
    assert.equal(beats(bomb5, straight6), true);
    assert.equal(beats(bomb9, bomb5), true);
    assert.equal(beats(bomb5, bomb9), false);
    assert.equal(beats(bomb9, royalLow), false, "a bomb cannot beat a royal straight");
  });

  test("a bomb beats a Joker played as a single", () => {
    assert.equal(beats(bomb5, buildCombination([j("colored")])!), true);
  });

  test("royal straight beats anything; only a higher royal of the same card count beats it", () => {
    assert.equal(beats(royalLow, bomb9), true);
    assert.equal(beats(royalLow, straight5), true);
    assert.equal(beats(royalHigh, royalLow), true);
    assert.equal(beats(royalLow, royalHigh), false);

    const royalLongLow = buildCombination([
      c("3", "clubs"), c("4", "clubs"), c("5", "clubs"),
      c("6", "clubs"), c("7", "clubs"), c("8", "clubs"),
    ])!;
    const royalLongHigh = buildCombination([
      c("8", "hearts"), c("9", "hearts"), c("10", "hearts"),
      c("J", "hearts"), c("Q", "hearts"), c("K", "hearts"),
    ])!;
    assert.equal(royalLongHigh.type, "royal_straight");
    assert.ok(royalLongHigh.strength > royalLow.strength && royalHigh.strength > royalLongLow.strength);
    assert.equal(beats(royalLongHigh, royalLow), false, "a longer royal does not beat a shorter one");
    assert.equal(beats(royalHigh, royalLongLow), false, "a shorter royal does not beat a longer one");
  });

  test("normal plays cannot answer a bomb or a royal straight", () => {
    assert.equal(beats(pair8, bomb5), false);
    assert.equal(beats(straight5, royalLow), false);
  });
});

describe("how a card is written", () => {
  test("both jokers read JKR and every other rank reads as itself", () => {
    assert.equal(getCardDisplayRank("joker_colored"), "JKR");
    assert.equal(getCardDisplayRank("joker_bw"), "JKR");
    assert.deepEqual((["3", "10", "J", "A", "2"] as const).map(getCardDisplayRank), ["3", "10", "J", "A", "2"]);
  });

  test("each suit has its symbol and a joker's missing suit reads as nothing", () => {
    assert.deepEqual(
      (["hearts", "diamonds", "clubs", "spades"] as const).map(getSuitSymbol),
      ["♥", "♦", "♣", "♠"]
    );
    assert.equal(getSuitSymbol(null), "");
  });
});
