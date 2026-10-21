import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { canBeatPileOf, readStagedPlay } from "../../lib/table/stagedPlay.ts";
import { TUTORIAL_REFUSAL_KEYS } from "../../lib/tutorial/beats.ts";
import { card, seat as makePlayer, state as makeState } from "../support/game.ts";
import { passed } from "../support/moves.ts";
import {
  applyMove,
  buildCombination,
  tableDemand,
  type Card,
  type Combination,
  type Rank,
  type Suit,
} from "../../lib/game/gameEngine.ts";

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
    demand: { toBeat: null, mustInclude: null },
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

  test("a selection of cards no longer in the hand is refused with the engine's code, not waved through", () => {
    const s = staged({ selectedIds: ["Q_hearts"] });
    assert.deepEqual(s.cards, []);
    assert.equal(s.playable, false);
    assert.equal(s.refusal, "notACombination");
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
    const s = staged({ ...pair, demand: { toBeat: pairOfSevens, mustInclude: null } });
    assert.equal(s.playable, false);
    assert.equal(s.refusal, "tooLow");
  });

  test("the same pair leads freely once the round has closed", () => {
    const closed = passed(
      makeState({ players: [makePlayer(0, HAND), makePlayer(1, [card("2", "clubs")])], currentTurnIndex: 1, lastPlayedBy: 0, lastPlayedCombination: pairOfSevens })
    );
    assert.equal(staged({ ...pair, demand: tableDemand(closed) }).playable, true);
  });
});

describe("the opening play", () => {
  const opening = { demand: { toBeat: null, mustInclude: THREE_SPADES } };

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
      staged({ demand: tableDemand(makeState({ openingCard: null })), selectedIds: ["9_diamonds"] }).playable,
      true
    );
  });
});

describe("whether the hand can answer the trick at all", () => {
  const beatable = (over: Partial<Parameters<typeof canBeatPileOf>[0]>) =>
    canBeatPileOf({
      hand: HAND,
      demand: { toBeat: null, mustInclude: null },
      isMyTurn: true,
      isFinished: false,
      ...over,
    });

  test("a hand holding a higher pair can beat a pair", () => {
    const onSevens = { toBeat: pairOfSevens, mustInclude: null };
    assert.equal(beatable({ demand: onSevens }), false);
    assert.equal(
      beatable({ hand: [...HAND, card("J", "spades"), card("J", "hearts")], demand: onSevens }),
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
    assert.equal(beatable({ demand: { toBeat: null, mustInclude: card("4", "clubs") } }), false);
    assert.equal(beatable({ demand: { toBeat: null, mustInclude: THREE_SPADES } }), true);
  });
});


const run = (suit: Suit, ranks: Rank[]) => ranks.map((rank) => card(rank, suit));
const bombOf = (rank: Rank) =>
  (["spades", "hearts", "clubs", "diamonds"] as const).map((s) => card(rank, s));

const START = card("3", "spades");

type Row = {
  name: string;
  selection: Card[];
  pile: Card[] | null;
  opening?: boolean;
  refusal: string;
  tutorialKey?: string;
};

const rows: Row[] = [
  { name: "no combination", selection: [card("5", "hearts"), card("K", "hearts")], pile: null, refusal: "notACombination", tutorialKey: "tutorial.errNotAValidCombo" },
  { name: "an opening without the start card", selection: [card("5", "hearts")], pile: null, opening: true, refusal: "needsStartCard" },
  { name: "an opening without the start card, on a pile it would not beat", selection: [card("5", "hearts")], pile: [card("A", "clubs")], opening: true, refusal: "needsStartCard" },
  { name: "a single on a royal straight", selection: [card("K", "hearts")], pile: run("diamonds", ["9", "10", "J", "Q", "K"]), refusal: "royalUnbeatable", tutorialKey: "tutorial.errRoyalBeatsAll" },
  { name: "a bomb on a royal straight", selection: bombOf("6"), pile: run("diamonds", ["9", "10", "J", "Q", "K"]), refusal: "royalUnbeatable", tutorialKey: "tutorial.errRoyalBeatsAll" },
  { name: "a single on a bomb", selection: [card("K", "hearts")], pile: bombOf("4"), refusal: "bombOnly", tutorialKey: "tutorial.errOnlyHigherBomb" },
  { name: "a pair on a single", selection: [card("5", "hearts"), card("5", "clubs")], pile: [card("4", "diamonds")], refusal: "wrongType", tutorialKey: "tutorial.errSameType" },
  { name: "a five-card straight on a six-card one", selection: [card("4", "hearts"), card("5", "clubs"), card("6", "hearts"), card("7", "hearts"), card("8", "clubs")], pile: [card("4", "diamonds"), card("5", "diamonds"), card("6", "clubs"), card("7", "diamonds"), card("8", "diamonds"), card("9", "clubs")], refusal: "wrongLength", tutorialKey: "tutorial.errSameLength" },
  { name: "a royal straight on a royal straight of another length", selection: run("spades", ["8", "9", "10", "J", "Q", "K"]), pile: run("hearts", ["3", "4", "5", "6", "7"]), refusal: "wrongLength", tutorialKey: "tutorial.errSameLength" },
  { name: "a royal straight on a higher one of its length", selection: run("spades", ["4", "5", "6", "7", "8"]), pile: run("hearts", ["9", "10", "J", "Q", "K"]), refusal: "tooLow", tutorialKey: "tutorial.errTooWeak" },
  { name: "a single too low", selection: [card("K", "hearts")], pile: [card("A", "diamonds")], refusal: "tooLow", tutorialKey: "tutorial.errTooWeak" },
  { name: "a bomb too low", selection: bombOf("6"), pile: bombOf("J"), refusal: "tooLow", tutorialKey: "tutorial.errTooWeak" },
];


describe("one reason for a refused play", () => {
  for (const row of rows) {
    test(row.name, () => {
      const hand = [START, ...row.selection];
      const lastPlayedCombination = row.pile ? buildCombination(row.pile) : null;
      const table = { lastPlayedCombination, openingCard: row.opening ? START : null };
      const ids = row.selection.map((card) => card.id);

      const engine = applyMove(
        makeState({ players: [makePlayer(0, hand), makePlayer(1, [card("2", "clubs")])],
          ...table,
          lastPlayedBy: 1,
        }),
        0,
        { kind: "play", cardIds: ids }
      );
      assert.deepEqual(engine, { ok: false, code: row.refusal }, "the engine");

      const read = readStagedPlay({
        demand: tableDemand(table),
        hand,
        selectedIds: ids,
        isMyTurn: true,
        isFinished: false,
      });
      assert.equal(read.playable, false);
      assert.equal(read.refusal, row.refusal, "GIOCA's label");
      assert.equal(TUTORIAL_REFUSAL_KEYS[read.refusal], row.tutorialKey, "the tutorial's sentence");
    });
  }

  test("empty selection, not my turn and finished all read play", () => {
    const hand = [START, card("5", "hearts")];
    const base = { hand, demand: { toBeat: null, mustInclude: null }, isMyTurn: true, isFinished: false };
    assert.equal(readStagedPlay({ ...base, selectedIds: [] }).refusal, "play");
    assert.equal(readStagedPlay({ ...base, selectedIds: ["5_hearts"], isMyTurn: false }).refusal, "play");
    assert.equal(readStagedPlay({ ...base, selectedIds: ["5_hearts"], isFinished: true }).refusal, "play");
  });
});
