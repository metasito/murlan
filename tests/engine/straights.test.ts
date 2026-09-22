import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildCombination,
  c,
  canPlayerPlay,
  cardKey,
  getAllValidPlays,
  getCombinationType,
  j,
  type Card,
} from "./helpers.ts";

const straightsOf = (hand: Card[], length?: number) =>
  getAllValidPlays(hand, null, true).filter(
    (p) =>
      (p.type === "straight" || p.type === "royal_straight") &&
      (length === undefined || p.cards.length === length)
  );

describe("straight legality", () => {
  test("minimum length is 5", () => {
    assert.equal(
      getCombinationType([
        c("3", "hearts"), c("4", "clubs"), c("5", "spades"), c("6", "diamonds"),
      ]),
      null
    );
  });

  test("2 is low inside a straight and never high", () => {
    assert.equal(
      getCombinationType([
        c("2", "hearts"), c("3", "clubs"), c("4", "spades"),
        c("5", "diamonds"), c("6", "hearts"),
      ]),
      "straight"
    );
    // K-A-2 wrap-around is illegal
    assert.equal(
      getCombinationType([
        c("10", "hearts"), c("J", "clubs"), c("Q", "spades"),
        c("K", "diamonds"), c("A", "hearts"), c("2", "clubs"),
      ]),
      null
    );
  });

  test("ace is both low and high but never both at once", () => {
    assert.equal(
      getCombinationType([
        c("A", "hearts"), c("2", "clubs"), c("3", "spades"),
        c("4", "diamonds"), c("5", "hearts"),
      ]),
      "straight"
    );
    assert.equal(
      getCombinationType([
        c("10", "hearts"), c("J", "clubs"), c("Q", "spades"),
        c("K", "diamonds"), c("A", "hearts"),
      ]),
      "straight"
    );
  });

  test("a 13-card straight is legal, read at its strongest orientation", () => {
    const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
    const cards = ranks.map((r, i) =>
      c(r, (["hearts", "clubs", "spades", "diamonds"] as const)[i % 4])
    );
    const combo = buildCombination(cards);
    assert.equal(combo?.type, "straight");
    // These 13 cards read either as A-2-…-K (top 13) or 2-3-…-K-A (top ace).
    // The engine takes the ace-high reading, which is the stronger of the two.
    assert.equal(combo?.strength, 14);
  });

  test("14 cards can never form a straight (the ace cannot be used twice)", () => {
    const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
    const cards = ranks.map((r) => c(r, "hearts"));
    cards.push(c("A", "spades"));
    assert.equal(getCombinationType(cards), null);
  });
});

describe("enumeration completeness", () => {
  test("duplicate ranks no longer poison the window (defect 1)", () => {
    const hand = [
      c("3", "spades"), c("4", "hearts"), c("5", "clubs"),
      c("5", "diamonds"), c("6", "spades"), c("7", "hearts"),
    ];
    const found = straightsOf(hand, 5);
    assert.ok(found.length > 0, "3-4-5-6-7 must be enumerated");
    assert.equal(canPlayerPlay(hand, null, true), true);
  });

  test("finds straights through several duplicated ranks", () => {
    const hand = [
      c("3", "spades"), c("3", "hearts"),
      c("4", "hearts"), c("4", "clubs"),
      c("5", "clubs"), c("5", "diamonds"),
      c("6", "spades"), c("6", "diamonds"),
      c("7", "hearts"), c("7", "spades"),
    ];
    const found = straightsOf(hand, 5);
    assert.ok(found.length > 0, "3-4-5-6-7 must be enumerated despite four duplicate ranks");
    assert.equal(found[0].strength, 7);
  });

  test("no 9-card cap: a 10-card finishing straight is playable (defect 2)", () => {
    const ranks = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q"] as const;
    const hand = ranks.map((r, i) =>
      c(r, (["hearts", "clubs", "spades", "diamonds"] as const)[i % 4])
    );
    const tens = straightsOf(hand, 10);
    assert.equal(tens.length, 1, "the full 10-card straight must be enumerated");
    assert.equal(tens[0].cards.length, hand.length, "it is a finishing play");
  });

  test("every length from 5 to the maximum run is enumerated", () => {
    const ranks = ["3", "4", "5", "6", "7", "8", "9", "10"] as const;
    const hand = ranks.map((r, i) =>
      c(r, (["hearts", "clubs", "spades", "diamonds"] as const)[i % 4])
    );
    for (let len = 5; len <= 8; len++) {
      assert.ok(
        straightsOf(hand, len).length > 0,
        `a ${len}-card straight must be enumerated`
      );
    }
  });

  test("both the ace-low and ace-high orientations are enumerated", () => {
    const hand = [
      c("A", "hearts"), c("2", "clubs"), c("3", "spades"),
      c("4", "diamonds"), c("5", "hearts"),
      c("10", "clubs"), c("J", "spades"), c("Q", "diamonds"), c("K", "hearts"),
    ];
    const strengths = new Set(straightsOf(hand, 5).map((p) => p.strength));
    assert.ok(strengths.has(5), "A-2-3-4-5 (ace low) must be found");
    assert.ok(strengths.has(14), "10-J-Q-K-A (ace high) must be found");
  });

  test("jokers are never pulled into a straight", () => {
    const hand = [
      c("3", "spades"), c("4", "hearts"), c("5", "clubs"),
      c("6", "spades"), j("bw"), j("colored"),
    ];
    assert.equal(straightsOf(hand).length, 0);
    const jokerPlays = getAllValidPlays(hand, null, true).filter((p) =>
      p.cards.some((card) => card.isJoker)
    );
    assert.ok(jokerPlays.every((p) => p.type === "single" && p.cards.length === 1));
  });

  test("plain straights are preferred over accidental royals when a mixed pick exists", () => {
    const hand = [
      c("3", "spades"), c("4", "spades"), c("5", "spades"),
      c("6", "spades"), c("7", "spades"), c("5", "hearts"),
    ];
    const found = straightsOf(hand, 5);
    const types = new Set(found.map((p) => p.type));
    assert.ok(types.has("royal_straight"), "the all-spades flush must be offered");
    assert.ok(types.has("straight"), "the mixed-suit plain straight must also be offered");
  });

  // Every window of a suited run is its own royal, so the longest is not the
  // only one offered. The 3-7 both suits hold is one play, not two — the
  // enumerator returns one entry per (length, strength).
  test("every distinct royal a suited run holds is enumerated, once each", () => {
    const hand = [
      c("3", "spades"), c("4", "spades"), c("5", "spades"),
      c("6", "spades"), c("7", "spades"), c("8", "spades"),
      c("3", "hearts"), c("4", "hearts"), c("5", "hearts"),
      c("6", "hearts"), c("7", "hearts"),
    ];
    const royals = getAllValidPlays(hand, null, true).filter(
      (p) => p.type === "royal_straight"
    );
    assert.deepEqual(
      royals.map((p) => `${p.cards.length}:${p.strength}`).sort(),
      ["5:7", "5:8", "6:8"]
    );
  });

  test("requireCard forces the 3 of spades into every enumerated play", () => {
    const hand = [
      c("3", "spades"), c("3", "hearts"), c("4", "hearts"),
      c("5", "clubs"), c("6", "spades"), c("7", "hearts"),
    ];
    const plays = getAllValidPlays(hand, null, true, c("3", "spades"));
    assert.ok(plays.length > 0);
    for (const play of plays) {
      assert.ok(
        play.cards.some((card) => card.id === "3_spades"),
        `play ${cardKey(play.cards)} must contain the 3 of spades`
      );
    }
    assert.ok(
      plays.some((p) => p.type === "straight" && p.cards.length === 5),
      "the opening straight 3s-4-5-6-7 must be available"
    );
  });

  test("enumeration does not inspect an oversized hand once per subset", () => {
    const suits = ["hearts", "clubs", "spades", "diamonds"] as const;
    const ranks = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"] as const;
    const size = 21;
    // Counting rank reads rather than milliseconds. This sees an enumerator
    // that reaches into the hand per subset, which is how the enumeration is
    // written; one that copied the ranks out first and then walked subsets of
    // the copy would read each card once and pass.
    let rankReads = 0;
    const hand: Card[] = [];
    for (const rank of ranks) {
      for (const suit of suits) {
        if (hand.length >= size) break;
        const card = c(rank, suit);
        Object.defineProperty(card, "rank", {
          get() {
            rankReads++;
            return rank;
          },
          enumerable: true,
        });
        hand.push(card);
      }
    }

    const plays = getAllValidPlays(hand, null, true);

    assert.ok(plays.length > 0);
    const ceiling = size ** 3;
    assert.ok(
      rankReads >= size,
      `enumeration read only ${rankReads} ranks for ${size} cards, so the counter is not seeing its work`
    );
    assert.ok(
      rankReads < ceiling,
      `enumeration read a card's rank ${rankReads} times for ${size} cards, over a cubic ceiling of ${ceiling} — it is walking subsets (2^${size} = ${2 ** size})`
    );
  });
});
