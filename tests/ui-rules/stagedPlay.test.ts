import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { canBeatPileOf, readStagedPlay } from "../../components/table/stagedPlay.ts";
import { TUTORIAL_REFUSAL_KEYS } from "../../components/tutorialRefusal.ts";
import { card as c, seat as makePlayer, state as makeState } from "../support/game.ts";
import {
  buildCombination,
  checkPlay,
  type Card,
  type Combination,
  type Rank,
  type Suit,
} from "../../lib/game/gameEngine.ts";

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
    isNewTrick: true,
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
      isNewTrick: false,
      lastPlayedCombination: pairOfSevens,
    });
    assert.equal(s.playable, false);
    assert.equal(s.refusal, "tooLow");
  });

  /**
   * The pile is still on the table when the round it belongs to has closed, so
   * only `isNewTrick` says whether it must be beaten. Reading the pile alone
   * would refuse the lead that opens the next round.
   */
  test("the same pair leads freely once the round has closed", () => {
    assert.equal(
      staged({ ...pair, isNewTrick: true, lastPlayedCombination: pairOfSevens }).playable,
      true
    );
  });
});

describe("the opening play", () => {
  const opening = { firstPlayMade: false, startCard: THREE_SPADES };

  test("a selection without the opening card is refused, however legal it is", () => {
    const s = staged({ ...opening, selectedIds: ["9_diamonds"] });
    assert.equal(s.playable, false);
    assert.equal(s.refusal, "needsStartCard");
  });

  test("and accepted once the opening card is in it", () => {
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

describe("whether the hand can answer the trick at all", () => {
  const beatable = (over: Partial<Parameters<typeof canBeatPileOf>[0]>) =>
    canBeatPileOf({
      hand: HAND,
      lastPlayedCombination: null,
      startCard: undefined,
      firstPlayMade: true,
      isNewTrick: true,
      isMyTurn: true,
      isFinished: false,
      ...over,
    });

  test("a hand holding a higher pair can beat a pair", () => {
    assert.equal(beatable({ lastPlayedCombination: pairOfSevens, isNewTrick: false }), false);
    assert.equal(
      beatable({
        hand: [...HAND, card("J", "spades"), card("J", "hearts")],
        lastPlayedCombination: pairOfSevens,
        isNewTrick: false,
      }),
      true
    );
  });

  test("a new round can always be led", () => {
    assert.equal(beatable({}), true);
  });

  test("off turn, and once out, nothing is answerable", () => {
    assert.equal(beatable({ isMyTurn: false }), false);
    assert.equal(beatable({ isFinished: true }), false);
  });

  test("the opening card constrains the opening lead", () => {
    const opening = { startCard: card("4", "clubs"), firstPlayMade: false };
    assert.equal(beatable(opening), false);
    assert.equal(beatable({ ...opening, startCard: THREE_SPADES }), true);
  });
});


const run = (suit: Suit, ranks: Rank[]) => ranks.map((rank) => c(rank, suit));
const bombOf = (rank: Rank) =>
  (["spades", "hearts", "clubs", "diamonds"] as const).map((s) => c(rank, s));

const START = c("3", "spades");

type Row = {
  name: string;
  selection: Card[];
  pile: Card[] | null;
  opening?: boolean;
  refusal: string;
  tutorialKey?: string;
};

const rows: Row[] = [
  { name: "no combination", selection: [c("5", "hearts"), c("K", "hearts")], pile: null, refusal: "notACombination", tutorialKey: "tutorial.errNotAValidCombo" },
  { name: "an opening without the start card", selection: [c("5", "hearts")], pile: null, opening: true, refusal: "needsStartCard" },
  { name: "an opening without the start card, on a pile it would not beat", selection: [c("5", "hearts")], pile: [c("A", "clubs")], opening: true, refusal: "needsStartCard" },
  { name: "a single on a royal straight", selection: [c("K", "hearts")], pile: run("diamonds", ["9", "10", "J", "Q", "K"]), refusal: "royalUnbeatable", tutorialKey: "tutorial.errRoyalBeatsAll" },
  { name: "a bomb on a royal straight", selection: bombOf("6"), pile: run("diamonds", ["9", "10", "J", "Q", "K"]), refusal: "royalUnbeatable", tutorialKey: "tutorial.errRoyalBeatsAll" },
  { name: "a single on a bomb", selection: [c("K", "hearts")], pile: bombOf("4"), refusal: "bombOnly", tutorialKey: "tutorial.errOnlyHigherBomb" },
  { name: "a pair on a single", selection: [c("5", "hearts"), c("5", "clubs")], pile: [c("4", "diamonds")], refusal: "wrongType", tutorialKey: "tutorial.errSameType" },
  { name: "a five-card straight on a six-card one", selection: [c("4", "hearts"), c("5", "clubs"), c("6", "hearts"), c("7", "hearts"), c("8", "clubs")], pile: [c("4", "diamonds"), c("5", "diamonds"), c("6", "clubs"), c("7", "diamonds"), c("8", "diamonds"), c("9", "clubs")], refusal: "wrongLength", tutorialKey: "tutorial.errSameLength" },
  { name: "a royal straight on a royal straight of another length", selection: run("spades", ["8", "9", "10", "J", "Q", "K"]), pile: run("hearts", ["3", "4", "5", "6", "7"]), refusal: "wrongLength", tutorialKey: "tutorial.errSameLength" },
  { name: "a royal straight on a higher one of its length", selection: run("spades", ["4", "5", "6", "7", "8"]), pile: run("hearts", ["9", "10", "J", "Q", "K"]), refusal: "tooLow", tutorialKey: "tutorial.errTooWeak" },
  { name: "a single too low", selection: [c("K", "hearts")], pile: [c("A", "diamonds")], refusal: "tooLow", tutorialKey: "tutorial.errTooWeak" },
  { name: "a bomb too low", selection: bombOf("6"), pile: bombOf("J"), refusal: "tooLow", tutorialKey: "tutorial.errTooWeak" },
];


describe("one reason for a refused play", () => {
  for (const row of rows) {
    test(row.name, () => {
      const hand = [START, ...row.selection];
      const lastPlayedCombination = row.pile ? buildCombination(row.pile) : null;
      const table = {
        lastPlayedCombination,
        startCard: START,
        firstPlayMade: !row.opening,
      };
      const ids = row.selection.map((card) => card.id);

      const engine = checkPlay(
        makeState([makePlayer("p0", hand), makePlayer("p1", [c("2", "clubs")])], {
          ...table,
          lastPlayedBy: 1,
        }),
        0,
        ids
      );
      assert.deepEqual(engine, { ok: false, code: row.refusal }, "the engine");

      const read = readStagedPlay({
        ...table,
        hand,
        selectedIds: ids,
        isNewTrick: lastPlayedCombination === null,
        isMyTurn: true,
        isFinished: false,
      });
      assert.equal(read.playable, false);
      assert.equal(read.refusal, row.refusal, "GIOCA's label");
      assert.equal(TUTORIAL_REFUSAL_KEYS[read.refusal], row.tutorialKey, "the tutorial's sentence");
    });
  }

  test("empty selection, not my turn and finished all read play", () => {
    const hand = [START, c("5", "hearts")];
    const base = { hand, lastPlayedCombination: null, startCard: START, firstPlayMade: true, isNewTrick: true, isMyTurn: true, isFinished: false };
    assert.equal(readStagedPlay({ ...base, selectedIds: [] }).refusal, "play");
    assert.equal(readStagedPlay({ ...base, selectedIds: ["5_hearts"], isMyTurn: false }).refusal, "play");
    assert.equal(readStagedPlay({ ...base, selectedIds: ["5_hearts"], isFinished: true }).refusal, "play");
  });
});
