// tests/ui-rules/playRefusalParity.test.ts — the engine, GIOCA's label and the
// tutorial give one reason for the same refused play.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readStagedPlay } from "../../components/table/stagedPlay.ts";
import { playButtonLabel } from "../../components/turnTimerUi.ts";
import { TUTORIAL_REFUSAL_KEYS } from "../../components/tutorialRefusal.ts";
import {
  buildCombination,
  c,
  checkPlay,
  makePlayer,
  makeState,
  type Card,
  type Rank,
  type Suit,
} from "../engine/helpers.ts";

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

const shape = (cards: Card[] | null) => {
  const combo = cards && buildCombination(cards);
  return combo ? { type: combo.type, length: combo.cards.length } : null;
};

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

      const label = playButtonLabel({
        isMyTurn: true,
        isFinished: false,
        selectedCount: ids.length,
        selection: shape(row.selection),
        pile: shape(row.pile),
        requiresStartCard: !!row.opening,
        selectionHasStartCard: false,
      });
      assert.equal(label, row.refusal, "GIOCA's label");

      const staged = readStagedPlay({
        ...table,
        hand,
        selectedIds: ids,
        isNewTrick: lastPlayedCombination === null,
        isMyTurn: true,
        isFinished: false,
      });
      assert.equal(staged.playable, false);
      assert.equal(staged.refusal, row.refusal, "the staged play the tutorial reads");
      assert.equal(TUTORIAL_REFUSAL_KEYS[staged.refusal], row.tutorialKey, "the tutorial's sentence");
    });
  }
});
