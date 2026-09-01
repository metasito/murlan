import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readStagedPlay } from "../components/table/stagedPlay.ts";
import type { Card, Combination, Rank } from "../lib/gameEngine.ts";

const card = (rank: Rank, suit: Card["suit"]): Card => ({
  id: `${rank}_${suit}`,
  rank,
  suit,
  isJoker: false,
});

const THREE_SPADES = card("3", "spades");
const HAND = [THREE_SPADES, card("3", "hearts"), card("5", "clubs"), card("9", "diamonds")];

const pairOfSevens: Combination = {
  type: "pair",
  cards: [card("7", "spades"), card("7", "hearts")],
  strength: 7,
};

const staged = (over: Partial<Parameters<typeof readStagedPlay>[0]>) =>
  readStagedPlay({
    hand: HAND,
    selectedIds: [],
    lastPlayedCombination: null,
    startCard: undefined,
    firstPlayMade: true,
    isNewRound: true,
    isMyTurn: true,
    isFinished: false,
    ...over,
  });

describe("what the selected cards amount to", () => {
  test("an empty selection is not playable, and says nothing is selected", () => {
    const s = staged({});
    assert.deepEqual(s.cards, []);
    assert.equal(s.playable, false);
    assert.equal(s.refusal, "play");
  });

  test("cards that are not a combination are refused as such", () => {
    const s = staged({ selectedIds: ["3_spades", "9_diamonds"] });
    assert.equal(s.playable, false);
    assert.equal(s.refusal, "notACombination");
  });

  test("the cards come back in hand order, not selection order", () => {
    const s = staged({ selectedIds: ["9_diamonds", "3_spades"] });
    assert.deepEqual(
      s.cards.map((c) => c.id),
      ["3_spades", "9_diamonds"]
    );
  });
});

describe("whether GIOCA will take them", () => {
  const pair = { selectedIds: ["3_spades", "3_hearts"] };

  test("a legal lead is playable", () => {
    assert.equal(staged(pair).playable, true);
  });

  test("…but not on somebody else's turn, and not after finishing", () => {
    assert.equal(staged({ ...pair, isMyTurn: false }).playable, false);
    assert.equal(staged({ ...pair, isFinished: true }).playable, false);
  });

  test("a lower pair cannot answer the pile", () => {
    const s = staged({
      ...pair,
      isNewRound: false,
      lastPlayedCombination: pairOfSevens,
    });
    assert.equal(s.playable, false);
    assert.equal(s.refusal, "tooLow");
  });

  /**
   * The pile is still on the table when the round it belongs to has closed, so
   * only `isNewRound` says whether it must be beaten. Reading the pile alone
   * would refuse the lead that opens the next round.
   */
  test("the same pair leads freely once the round has closed", () => {
    assert.equal(
      staged({ ...pair, isNewRound: true, lastPlayedCombination: pairOfSevens }).playable,
      true
    );
  });
});

describe("the opening play", () => {
  const opening = { firstPlayMade: false, startCard: THREE_SPADES };

  test("a selection without the start card is refused, however legal it is", () => {
    const s = staged({ ...opening, selectedIds: ["9_diamonds"] });
    assert.equal(s.playable, false);
    assert.equal(s.refusal, "needsStartCard");
  });

  test("and accepted once the start card is in it", () => {
    assert.equal(staged({ ...opening, selectedIds: ["3_spades"] }).playable, true);
    assert.equal(
      staged({ ...opening, selectedIds: ["3_spades", "3_hearts"] }).playable,
      true
    );
  });

  test("the gate lifts for good once the opening play has been made", () => {
    assert.equal(
      staged({ firstPlayMade: true, startCard: THREE_SPADES, selectedIds: ["9_diamonds"] })
        .playable,
      true
    );
  });
});
