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
  type Card,
  type Combination,
} from "./helpers.ts";

const HAND_SIZE = 10; // 2^10 subsets is exhaustively checkable
const RUNS = 250;

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

    for (let run = 0; run < RUNS; run++) {
      const hand = sample(deck, HAND_SIZE, rand);
      const lastPlayed = run % 2 === 0 ? null : randomLastPlayed(rand, deck);
      const isNewRound = lastPlayed === null;

      const expected = bruteForceLegalPlays(hand, isNewRound ? null : lastPlayed);
      const actual = getAllValidPlays(hand, lastPlayed, isNewRound);
      const actualShapes = new Set(actual.map(shapeOf));

      for (const play of expected) {
        assert.ok(
          actualShapes.has(shapeOf(play)),
          `run ${run}: missed ${shapeOf(play)} (${cardKey(play.cards)}) ` +
            `in hand ${cardKey(hand)} against ${lastPlayed ? cardKey(lastPlayed.cards) : "an open round"}`
        );
      }
    }
  });

  test("never returns an illegal play, and never invents a card", () => {
    const deck = createDeck();
    const rand = mulberry32(0x5eed);

    for (let run = 0; run < RUNS; run++) {
      const hand = sample(deck, HAND_SIZE, rand);
      const lastPlayed = run % 2 === 0 ? null : randomLastPlayed(rand, deck);
      const isNewRound = lastPlayed === null;
      const handIds = new Set(hand.map((card) => card.id));

      for (const play of getAllValidPlays(hand, lastPlayed, isNewRound)) {
        const rebuilt = buildCombination(play.cards);
        assert.ok(rebuilt, `run ${run}: ${cardKey(play.cards)} is not a valid combination`);
        assert.equal(rebuilt!.type, play.type);
        assert.equal(rebuilt!.strength, play.strength);
        assert.ok(
          canPlay(play, isNewRound ? null : lastPlayed),
          `run ${run}: ${cardKey(play.cards)} cannot legally be played`
        );
        assert.equal(
          new Set(play.cards.map((card) => card.id)).size,
          play.cards.length,
          "no card is used twice in one play"
        );
        for (const card of play.cards) {
          assert.ok(handIds.has(card.id), `run ${run}: ${card.id} is not in the hand`);
        }
      }
    }
  });

  test("canPlayerPlay agrees with brute force on every hand", () => {
    const deck = createDeck();
    const rand = mulberry32(0xbeef);

    for (let run = 0; run < RUNS; run++) {
      const hand = sample(deck, HAND_SIZE, rand);
      const lastPlayed = randomLastPlayed(rand, deck);
      const expected = bruteForceLegalPlays(hand, lastPlayed).length > 0;
      assert.equal(
        canPlayerPlay(hand, lastPlayed, false),
        expected,
        `run ${run}: hand ${cardKey(hand)} vs ${lastPlayed ? cardKey(lastPlayed.cards) : "null"}`
      );
    }
  });

  test("requireCard: every enumerated opening contains the required card", () => {
    const deck = createDeck();
    const rand = mulberry32(0x1234);

    for (let run = 0; run < 100; run++) {
      const hand = sample(deck, HAND_SIZE, rand);
      const required = hand[Math.floor(rand() * hand.length)];
      const plays = getAllValidPlays(hand, null, true, required);

      for (const play of plays) {
        assert.ok(
          play.cards.some((card) => card.id === required.id),
          `run ${run}: ${cardKey(play.cards)} omits the required ${required.id}`
        );
      }

      const expected = bruteForceLegalPlays(hand, null).filter((play) =>
        play.cards.some((card) => card.id === required.id)
      );
      const shapes = new Set(plays.map(shapeOf));
      for (const play of expected) {
        assert.ok(
          shapes.has(shapeOf(play)),
          `run ${run}: missed forced play ${shapeOf(play)} (${cardKey(play.cards)})`
        );
      }
    }
  });
});
