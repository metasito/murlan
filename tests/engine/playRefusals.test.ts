// tests/engine/playRefusals.test.ts — the engine names why a play or a pass is refused.
//
// The server, the offline table and the tutorial each map these codes to their own
// words; one row per code is what keeps any of them from classifying on its own.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { card as c, seat as makePlayer, state as makeState } from "../support/game.ts";
import {
  actingSeat,
  applyMove,
  buildCombination,
  type Card,
  type GameState,
  type Rank,
  type Suit,
} from "../../lib/game/gameEngine.ts";

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
  makeState({ players: [makePlayer(0, hand), makePlayer(1, [c("4", "clubs")])],
    currentTurnIndex: 0,
    openingCard: null,
    lastPlayedCombination: pile ? combo(pile) : null,
    lastPlayedBy: 1,
    ...over,
  });

const ids = (cards: Card[]) => cards.map((card) => card.id);
const openExchange = { kind: "open", winnerIdx: 0, loserIdx: 1, cardFromLoser: c("K", "hearts") } as const;

const play = (state: GameState, cards: string[]) => applyMove(state, 0, { kind: "play", cardIds: cards });
const pass = (state: GameState) => applyMove(state, 0, { kind: "pass" });

describe("a play names its refusal", () => {
  const rows: [string, GameState, Card[], string][] = [
    ["exchange open", table(null, { exchangePhase: openExchange }), [c("5", "spades")], "exchangeOpen"],
    ["a card the seat does not hold", table(null), [c("A", "diamonds")], "notHeld"],
    ["nothing selected", table(null), [], "notACombination"],
    ["cards forming no combination", table(null), [c("5", "spades"), c("K", "hearts")], "notACombination"],
    [
      "an opening play without the start card",
      table(null, { openingCard: c("3", "spades") }),
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
      assert.deepEqual(play(state, ids(cards)), { ok: false, code });
    });
  }

  test("the start card is asked for before the table is beaten", () => {
    const state = table([c("A", "diamonds")], { openingCard: c("3", "spades") });
    assert.deepEqual(play(state, [c("K", "hearts").id]), { ok: false, code: "needsStartCard" });
  });

  test("a legal play comes back as the combination the seat's own cards form", () => {
    const result = play(table([c("4", "diamonds")]), [c("K", "hearts").id]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.move.kind === "play" && ids(result.move.combo.cards), ["K_hearts"]);
  });

  test("a repeated id is the one card it names", () => {
    const result = play(table(null), ["K_hearts", "K_hearts"]);
    assert.equal(result.ok && result.move.kind === "play" && result.move.combo.type, "single");
  });

  test("a royal straight answers a lower one of its own length", () => {
    const state = table(straight("spades", ["7", "8", "9", "10", "J"]), {
      players: [makePlayer(0, highRoyal5), makePlayer(1, [c("4", "clubs")])],
    });
    assert.equal(play(state, ids(highRoyal5)).ok, true);
  });
});

describe("a pass names its refusal", () => {
  test("exchange open", () => {
    const state = table([c("4", "diamonds")], { exchangePhase: openExchange });
    assert.deepEqual(pass(state), { ok: false, code: "exchangeOpen" });
  });

  test("leading a fresh trick", () => {
    assert.deepEqual(pass(table(null)), { ok: false, code: "mustLead" });
  });

  test("answering a combination", () => {
    assert.equal(pass(table([c("4", "diamonds")])).ok, true);
  });
});

describe("while an exchange is open", () => {
  const open = (pile: Card[] | null) => table(pile, { exchangePhase: openExchange });

  test("the exchange is named before whose turn it is, for a play and for a pass", () => {
    assert.deepEqual(applyMove(open(null), 1, { kind: "play", cardIds: ["4_clubs"] }), { ok: false, code: "exchangeOpen" });
    assert.deepEqual(applyMove(open([c("4", "diamonds")]), 1, { kind: "pass" }), { ok: false, code: "exchangeOpen" });
  });

  test("the winner is the seat to act, wherever the turn marker sits", () => {
    const state = table(null, { exchangePhase: openExchange, currentTurnIndex: 1 });
    assert.equal(actingSeat(state), openExchange.winnerIdx);
    assert.equal(actingSeat({ ...state, exchangePhase: undefined }), 1);
  });
});
