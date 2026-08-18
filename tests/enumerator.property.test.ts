import { test, describe } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore — see tests/helpers.ts
import {
  buildCombination,
  canPlay,
  canPlayerPlay,
  cardKey,
  createDeck,
  getAllValidPlays,
  mulberry32,
  sample,
  STRAIGHT_MAX_LEN,
  type Card,
  type Combination,
} from "./helpers.ts";

/**
 * The oracle below is 2^n, which puts a ceiling on the hand sizes it can
 * answer for. 13 and 14 are what a four-player deal produces; 10 is kept
 * because it is cheap enough to run a lot of.
 */
const EXHAUSTIVE_RUNS: Record<number, number> = { 10: 200, 13: 80, 14: 30 };

/** Every hand size the deal actually produces: 4p → 14/13, 3p → 18, 2p → 27. */
const REAL_SIZES = [13, 14, 18, 27];

/**
 * The largest play the bounded oracle enumerates for hands too big for 2^n.
 * Short of STRAIGHT_MAX_LEN, so that oracle answers for singles, pairs,
 * triples, bombs and the shortest straights but not for long ones.
 */
const BOUNDED_LEN = 6;

/** Runs per hand size for the bounded oracle — 27 cards costs ~150ms a hand. */
const BOUNDED_RUNS: Record<number, number> = { 18: 40, 27: 15 };

/**
 * Every legal play in `hand`, found by brute force over all 2^n subsets.
 * This is the oracle the enumerator is measured against.
 */
function bruteForceLegalPlays(
  hand: Card[],
  lastPlayed: Combination | null
): Combination[] {
  const found: Combination[] = [];
  const total = 1 << hand.length;
  for (let mask = 1; mask < total; mask++) {
    const selected: Card[] = [];
    for (let i = 0; i < hand.length; i++) {
      if (mask & (1 << i)) selected.push(hand[i]);
    }
    const combo = buildCombination(selected);
    if (combo && canPlay(combo, lastPlayed)) found.push(combo);
  }
  return found;
}

/** The same search, over subsets of at most `maxLen` cards. */
function boundedLegalPlays(
  hand: Card[],
  lastPlayed: Combination | null,
  maxLen: number
): Combination[] {
  const found: Combination[] = [];
  const selected: Card[] = [];
  const walk = (start: number) => {
    if (selected.length > 0) {
      const combo = buildCombination([...selected]);
      if (combo && canPlay(combo, lastPlayed)) found.push(combo);
    }
    if (selected.length === maxLen) return;
    for (let i = start; i < hand.length; i++) {
      selected.push(hand[i]);
      walk(i + 1);
      selected.pop();
    }
  };
  walk(0);
  return found;
}

/** type + card count + strength — the properties that decide legality. */
const shapeOf = (play: Combination) =>
  `${play.type}:${play.cards.length}:${play.strength}`;

/** A random combination drawn from the deck, to answer against. */
function randomLastPlayed(rand: () => number, deck: Card[]): Combination | null {
  for (let attempt = 0; attempt < 40; attempt++) {
    const size = 1 + Math.floor(rand() * 6); // 1..6 cards
    const combo = buildCombination(sample(deck, size, rand));
    if (combo) return combo;
  }
  return null;
}

describe("enumerator property tests", () => {
  test("finds every legal play a brute-force search finds", () => {
    const deck = createDeck();
    const rand = mulberry32(0xc0ffee);

    for (const [size, runs] of Object.entries(EXHAUSTIVE_RUNS)) {
      for (let run = 0; run < runs; run++) {
        const hand = sample(deck, Number(size), rand);
        const lastPlayed = run % 2 === 0 ? null : randomLastPlayed(rand, deck);
        const isNewRound = lastPlayed === null;

        const expected = bruteForceLegalPlays(hand, isNewRound ? null : lastPlayed);
        const actual = getAllValidPlays(hand, lastPlayed, isNewRound);
        const actualShapes = new Set(actual.map(shapeOf));

        for (const play of expected) {
          assert.ok(
            actualShapes.has(shapeOf(play)),
            `${size} cards, run ${run}: missed ${shapeOf(play)} (${cardKey(play.cards)}) ` +
              `in hand ${cardKey(hand)} against ${lastPlayed ? cardKey(lastPlayed.cards) : "an open round"}`
          );
        }
      }
    }
  });

  /**
   * 18 and 27 are past what 2^n can answer for, and they are the sizes a
   * three- and a two-player deal produce — so the enumerator's completeness
   * on a real hand was never measured at all. This asks the same question of
   * every play up to BOUNDED_LEN cards; longer straights are out of its
   * reach, and stay covered by the exhaustive sizes above.
   */
  test("finds every short play in a genuine 18- and 27-card hand", () => {
    assert.ok(BOUNDED_LEN < STRAIGHT_MAX_LEN, "the bound must be a real bound");
    const deck = createDeck();
    const rand = mulberry32(0xfa11);

    for (const [size, runs] of Object.entries(BOUNDED_RUNS)) {
      for (let run = 0; run < runs; run++) {
        const hand = sample(deck, Number(size), rand);
        const lastPlayed = run % 2 === 0 ? null : randomLastPlayed(rand, deck);
        const isNewRound = lastPlayed === null;

        const expected = boundedLegalPlays(
          hand,
          isNewRound ? null : lastPlayed,
          BOUNDED_LEN
        );
        assert.ok(expected.length > 0, `${size} cards, run ${run}: the oracle found nothing`);
        const actualShapes = new Set(
          getAllValidPlays(hand, lastPlayed, isNewRound).map(shapeOf)
        );

        for (const play of expected) {
          assert.ok(
            actualShapes.has(shapeOf(play)),
            `${size} cards, run ${run}: missed ${shapeOf(play)} (${cardKey(play.cards)})`
          );
        }
      }
    }
  });

  test("never returns an illegal play, and never invents a card", () => {
    const deck = createDeck();
    const rand = mulberry32(0x5eed);

    for (const size of REAL_SIZES) {
      for (let run = 0; run < 120; run++) {
        const hand = sample(deck, size, rand);
        const lastPlayed = run % 2 === 0 ? null : randomLastPlayed(rand, deck);
        const isNewRound = lastPlayed === null;
        const handIds = new Set(hand.map((card) => card.id));

        for (const play of getAllValidPlays(hand, lastPlayed, isNewRound)) {
          const rebuilt = buildCombination(play.cards);
          assert.ok(rebuilt, `${size} cards, run ${run}: ${cardKey(play.cards)} is not a valid combination`);
          assert.equal(rebuilt!.type, play.type);
          assert.equal(rebuilt!.strength, play.strength);
          assert.ok(
            canPlay(play, isNewRound ? null : lastPlayed),
            `${size} cards, run ${run}: ${cardKey(play.cards)} cannot legally be played`
          );
          assert.equal(
            new Set(play.cards.map((card) => card.id)).size,
            play.cards.length,
            "no card is used twice in one play"
          );
          for (const card of play.cards) {
            assert.ok(handIds.has(card.id), `${size} cards, run ${run}: ${card.id} is not in the hand`);
          }
        }
      }
    }
  });

  test("canPlayerPlay agrees with brute force on every hand", () => {
    const deck = createDeck();
    const rand = mulberry32(0xbeef);

    for (const [size, runs] of Object.entries(EXHAUSTIVE_RUNS)) {
      for (let run = 0; run < runs; run++) {
        const hand = sample(deck, Number(size), rand);
        const lastPlayed = randomLastPlayed(rand, deck);
        const expected = bruteForceLegalPlays(hand, lastPlayed).length > 0;
        assert.equal(
          canPlayerPlay(hand, lastPlayed, false),
          expected,
          `${size} cards, run ${run}: hand ${cardKey(hand)} vs ${lastPlayed ? cardKey(lastPlayed.cards) : "null"}`
        );
      }
    }
  });

  test("requireCard: every enumerated opening contains the required card", () => {
    const deck = createDeck();
    const rand = mulberry32(0x1234);

    for (const [size, runs] of Object.entries(EXHAUSTIVE_RUNS)) {
      for (let run = 0; run < Math.ceil(runs / 2); run++) {
        const hand = sample(deck, Number(size), rand);
        const required = hand[Math.floor(rand() * hand.length)];
        const plays = getAllValidPlays(hand, null, true, required);

        for (const play of plays) {
          assert.ok(
            play.cards.some((card) => card.id === required.id),
            `${size} cards, run ${run}: ${cardKey(play.cards)} omits the required ${required.id}`
          );
        }

        const expected = bruteForceLegalPlays(hand, null).filter((play) =>
          play.cards.some((card) => card.id === required.id)
        );
        const shapes = new Set(plays.map(shapeOf));
        for (const play of expected) {
          assert.ok(
            shapes.has(shapeOf(play)),
            `${size} cards, run ${run}: missed forced play ${shapeOf(play)} (${cardKey(play.cards)})`
          );
        }
      }
    }
  });
});
