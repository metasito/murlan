import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { c, j } from "./helpers.ts";
import { cardStrength, type Card } from "../lib/gameEngine.ts";
import {
  handHasLegalRoyalStraight,
  isCertainLead,
} from "../scripts/measureHeadsUpBalance.ts";

describe("handHasLegalRoyalStraight", () => {
  test("no cards of any suit reach 5 in a row: false", () => {
    const hand: Card[] = [
      c("3", "hearts"), c("4", "hearts"), c("6", "hearts"), c("7", "hearts"),
      c("2", "clubs"),
    ];
    assert.equal(handHasLegalRoyalStraight(hand), false);
  });

  test("5 consecutive same-suit cards, 2 low: true (mirrors tests/straights.test.ts)", () => {
    const hand: Card[] = [
      c("2", "hearts"), c("3", "hearts"), c("4", "hearts"), c("5", "hearts"),
      c("6", "hearts"), c("K", "clubs"),
    ];
    assert.equal(handHasLegalRoyalStraight(hand), true);
  });

  test("5 consecutive same-suit cards, ace high: true", () => {
    const hand: Card[] = [
      c("10", "spades"), c("J", "spades"), c("Q", "spades"), c("K", "spades"),
      c("A", "spades"),
    ];
    assert.equal(handHasLegalRoyalStraight(hand), true);
  });

  test("K-A-2 wrap is not a straight: false", () => {
    // No leading 10 here on purpose: J-Q-K-A alone is only a 4-run, so this
    // hand has no legal 5-run under either convention unless the illegal
    // K-A-2 wrap were (wrongly) allowed to close it.
    const hand: Card[] = [
      c("J", "diamonds"), c("Q", "diamonds"),
      c("K", "diamonds"), c("A", "diamonds"), c("2", "diamonds"),
    ];
    assert.equal(handHasLegalRoyalStraight(hand), false);
  });

  test("5 consecutive cards split across two suits: false (not same-suit)", () => {
    const hand: Card[] = [
      c("3", "hearts"), c("4", "hearts"), c("5", "clubs"), c("6", "hearts"),
      c("7", "hearts"),
    ];
    assert.equal(handHasLegalRoyalStraight(hand), false);
  });

  test("jokers never contribute: a hand of only jokers and a short same-suit run is false", () => {
    const hand: Card[] = [j("bw"), j("colored"), c("3", "spades"), c("4", "spades")];
    assert.equal(handHasLegalRoyalStraight(hand), false);
  });

  test("6 consecutive same-suit cards still counts (any run >= 5, not exactly 5)", () => {
    const hand: Card[] = [
      c("3", "clubs"), c("4", "clubs"), c("5", "clubs"), c("6", "clubs"),
      c("7", "clubs"), c("8", "clubs"),
    ];
    assert.equal(handHasLegalRoyalStraight(hand), true);
  });
});

describe("isCertainLead", () => {
  test("a single with nothing higher outstanding and no bomb possible: certain", () => {
    // Every other 2 and both jokers already played or in my own hand, and no
    // rank still has all 4 copies outstanding.
    const hand: Card[] = [c("2", "hearts")];
    const playedRanks: number[] = new Array(15).fill(0);
    playedRanks[cardStrength(c("2", "clubs"))] = 3; // 3 of the other 3 twos played
    playedRanks[13] = 1; // joker_bw played
    playedRanks[14] = 1; // joker_colored played
    // all 4 of every other rank played too, so no bomb is possible
    for (let i = 0; i < 12; i++) playedRanks[i] = 4;
    const single = { type: "single" as const, cards: [c("2", "hearts")], strength: cardStrength(c("2", "hearts")) };
    assert.equal(isCertainLead(single, playedRanks, hand), true);
  });

  test("a pair is never a certain lead, regardless of ranks", () => {
    const hand: Card[] = [c("A", "hearts"), c("A", "clubs")];
    const pair = { type: "pair" as const, cards: hand, strength: cardStrength(c("A", "hearts")) };
    assert.equal(isCertainLead(pair, undefined, hand), false);
  });

  test("a single is not certain when a higher rank is still outstanding", () => {
    const hand: Card[] = [c("K", "hearts")];
    const single = { type: "single" as const, cards: hand, strength: cardStrength(c("K", "hearts")) };
    assert.equal(isCertainLead(single, undefined, hand), false); // A and 2 still outstanding
  });
});
