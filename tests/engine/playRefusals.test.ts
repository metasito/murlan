// tests/engine/playRefusals.test.ts — the engine names why a play or a pass is refused.
//
// The server, the offline table and the tutorial each map these codes to their own
// words; one row per code is what keeps any of them from classifying on its own.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildCombination,
  c,
  checkPass,
  checkPlay,
  makePlayer,
  makeState,
  type Card,
  type GameState,
  type Rank,
  type Suit,
} from "./helpers.ts";

const combo = (cards: Card[]) => buildCombination(cards)!;

const straight = (suit: Suit, ranks: Rank[]) => ranks.map((rank) => c(rank, suit));

const royal5 = straight("hearts", ["3", "4", "5", "6", "7"]);
const royal6 = straight("spades", ["8", "9", "10", "J", "Q", "K"]);
const highRoyal5 = straight("diamonds", ["9", "10", "J", "Q", "K"]);
const bombOf = (rank: Rank) =>
  (["spades", "hearts", "clubs", "diamonds"] as const).map((s) => c(rank, s));

const hand = [
  c("3", "spades"),
  c("5", "spades"),
  c("5", "hearts"),
  c("K", "hearts"),
  ...royal6,
  ...bombOf("6"),
];

const table = (pile: Card[] | null, over: Partial<GameState> = {}) =>
  makeState([makePlayer("p0", hand), makePlayer("p1", [c("4", "clubs")])], {
    currentTurnIndex: 0,
    firstPlayMade: true,
    lastPlayedCombination: pile ? combo(pile) : null,
    lastPlayedBy: 1,
    ...over,
  });

const ids = (cards: Card[]) => cards.map((card) => card.id);
const openExchange = {
  active: true,
  winnerIdx: 0,
  loserIdx: 1,
  cardFromLoser: c("K", "hearts"),
  twoJokerException: false,
};

describe("checkPlay names the refusal", () => {
  const rows: [string, GameState, Card[], string][] = [
    ["exchange open", table(null, { exchangePhase: openExchange }), [c("5", "spades")], "exchangeOpen"],
    ["a card the seat does not hold", table(null), [c("A", "diamonds")], "notHeld"],
    ["nothing selected", table(null), [], "notACombination"],
    ["cards forming no combination", table(null), [c("5", "spades"), c("K", "hearts")], "notACombination"],
    [
      "an opening play without the start card",
      table(null, { firstPlayMade: false, startCard: c("3", "spades") }),
      [c("5", "spades")],
      "needsStartCard",
    ],
    ["a bomb on a royal straight", table(highRoyal5), bombOf("6"), "royalUnbeatable"],
    ["a single on a royal straight", table(highRoyal5), [c("K", "hearts")], "royalUnbeatable"],
    ["a single on a bomb", table(bombOf("4")), [c("K", "hearts")], "bombOnly"],
    ["a pair on a single", table([c("4", "diamonds")]), [c("5", "spades"), c("5", "hearts")], "wrongType"],
    ["a royal straight on a royal straight of another length", table(royal5), royal6, "wrongLength"],
    ["a single too low", table([c("A", "diamonds")]), [c("K", "hearts")], "tooLow"],
    ["a bomb too low", table(bombOf("J")), bombOf("6"), "tooLow"],
  ];

  for (const [name, state, cards, code] of rows) {
    test(name, () => {
      assert.deepEqual(checkPlay(state, 0, ids(cards)), { ok: false, code });
    });
  }

  test("the start card is asked for before the table is beaten", () => {
    const state = table([c("A", "diamonds")], { firstPlayMade: false, startCard: c("3", "spades") });
    assert.deepEqual(checkPlay(state, 0, [c("K", "hearts").id]), { ok: false, code: "needsStartCard" });
  });

  test("a legal play comes back as the combination the seat's own cards form", () => {
    const result = checkPlay(table([c("4", "diamonds")]), 0, [c("K", "hearts").id]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && ids(result.combo.cards), ["K_hearts"]);
  });

  test("a repeated id is the one card it names", () => {
    const result = checkPlay(table(null), 0, ["K_hearts", "K_hearts"]);
    assert.equal(result.ok && result.combo.type, "single");
  });

  test("a royal straight answers a lower one of its own length", () => {
    const state = table(straight("spades", ["7", "8", "9", "10", "J"]), {
      players: [makePlayer("p0", highRoyal5), makePlayer("p1", [c("4", "clubs")])],
    });
    assert.equal(checkPlay(state, 0, ids(highRoyal5)).ok, true);
  });
});

describe("checkPass names the refusal", () => {
  test("exchange open", () => {
    const state = table([c("4", "diamonds")], { exchangePhase: openExchange });
    assert.deepEqual(checkPass(state), { ok: false, code: "exchangeOpen" });
  });

  test("leading a fresh trick", () => {
    assert.deepEqual(checkPass(table(null)), { ok: false, code: "mustLead" });
  });

  test("answering a combination", () => {
    assert.deepEqual(checkPass(table([c("4", "diamonds")])), { ok: true });
  });
});
