import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  c,
  getBestCardFromHand,
  getStartingPlayerAfterExchange,
  getValidGivebackCards,
  initializeRematch,
  j,
  loserHasBothJokers,
  makePlayer,
  makeState,
  processExchangeChoice,
  type Card,
} from "./helpers.ts";

const ids = (cards: Card[]) => cards.map((card) => card.id).sort();

describe("getValidGivebackCards (defect 7)", () => {
  test("primary rule: any card ranked 3 to 10", () => {
    const hand = [
      c("3", "spades"), c("10", "hearts"), c("J", "clubs"),
      c("A", "diamonds"), c("2", "spades"), j("bw"),
    ];
    assert.deepEqual(ids(getValidGivebackCards(hand)), ids([c("3", "spades"), c("10", "hearts")]));
  });

  test("FALLBACK: a hand with no 3-10 card offers its lowest card instead of nothing", () => {
    const hand = [c("K", "clubs"), c("J", "hearts"), c("A", "spades"), j("colored")];
    const valid = getValidGivebackCards(hand);
    assert.equal(valid.length, 1, "the exchange must never be left with zero choices");
    assert.equal(valid[0].id, "J_hearts", "the lowest card is the fallback giveback");
  });

  test("empty hand yields no choices and does not crash", () => {
    assert.deepEqual(getValidGivebackCards([]), []);
  });
});

describe("processExchangeChoice", () => {
  const buildState = (winnerHand: Card[], loserHand: Card[]) =>
    makeState(
      [makePlayer("winner", winnerHand), makePlayer("loser", loserHand)],
      {
        currentTurnIndex: 0,
        lastPlayedBy: 0,
        exchangePhase: {
          active: true,
          winnerIdx: 0,
          loserIdx: 1,
          cardFromLoser: c("2", "spades"),
          bothJokersException: false,
        },
      }
    );

  test("moves the chosen card and hands the lead to the loser", () => {
    const state = buildState([c("4", "hearts"), c("K", "spades")], [c("9", "clubs")]);
    const next = processExchangeChoice(state, "4_hearts");
    assert.deepEqual(next.players[0].hand.map((card) => card.id), ["K_spades"]);
    assert.ok(next.players[1].hand.some((card) => card.id === "4_hearts"));
    assert.equal(next.exchangePhase?.active, false);
    assert.equal(next.currentTurnIndex, 1, "the loser leads the new hand");
    assert.equal(next.lastPlayedBy, 1);
  });

  test("rejects a card outside 3-10 while a legal one exists", () => {
    const state = buildState([c("4", "hearts"), c("K", "spades")], [c("9", "clubs")]);
    assert.equal(processExchangeChoice(state, "K_spades"), state);
  });

  test("rejects a card the winner does not hold", () => {
    const state = buildState([c("4", "hearts")], [c("9", "clubs")]);
    assert.equal(processExchangeChoice(state, "7_clubs"), state);
  });

  test("REGRESSION: the fallback card is accepted, so the exchange cannot deadlock", () => {
    const winnerHand = [c("K", "clubs"), c("J", "hearts"), c("A", "spades")];
    const state = buildState(winnerHand, [c("9", "clubs")]);
    const offered = getValidGivebackCards(winnerHand);
    assert.equal(offered.length, 1);

    const next = processExchangeChoice(state, offered[0].id);
    assert.notEqual(next, state, "the only offered choice must be accepted");
    assert.equal(next.exchangePhase?.active, false);
    assert.ok(next.players[1].hand.some((card) => card.id === offered[0].id));
  });

  const withReceived = (winnerHand: Card[], received: Card) =>
    makeState(
      [makePlayer("winner", winnerHand), makePlayer("loser", [c("4", "clubs")])],
      {
        currentTurnIndex: 0,
        lastPlayedBy: 0,
        exchangePhase: {
          active: true,
          winnerIdx: 0,
          loserIdx: 1,
          cardFromLoser: received,
          bothJokersException: false,
        },
      }
    );

  test("the card the loser just handed over cannot be handed straight back", () => {
    const received = c("10", "hearts");
    const winnerHand = [received, c("6", "clubs"), c("K", "spades")];
    assert.deepEqual(
      ids(getValidGivebackCards(winnerHand, received.id)),
      ids([c("6", "clubs")]),
      "only the winner's own 3-10 card is on offer"
    );
    const state = withReceived(winnerHand, received);
    assert.equal(processExchangeChoice(state, received.id), state);
  });

  test("excluding the received card still leaves exactly one fallback choice", () => {
    const received = c("10", "hearts");
    const winnerHand = [received, c("K", "clubs"), c("A", "spades")];
    const offered = getValidGivebackCards(winnerHand, received.id);
    assert.equal(offered.length, 1, "the exchange must never be left with zero choices");
    assert.equal(offered[0].id, "K_clubs");

    const next = processExchangeChoice(withReceived(winnerHand, received), offered[0].id);
    assert.equal(next.exchangePhase?.active, false);
  });

  test("does nothing when the exchange phase is not active", () => {
    const state = makeState([makePlayer("a", [c("4", "hearts")]), makePlayer("b", [])]);
    assert.equal(processExchangeChoice(state, "4_hearts"), state);
  });
});

describe("hand-to-hand exchange setup", () => {
  const setup = [0, 1, 2, 3].map((i) => ({
    name: `p${i}`,
    type: "human" as const,
    id: `player_${i}`,
  }));

  test("the loser's highest card moves to the winner and the loser leads", () => {
    for (let i = 0; i < 50; i++) {
      const state = initializeRematch(setup, "free_for_all", [
        "player_0", "player_1", "player_2", "player_3",
      ]);
      const phase = state.exchangePhase!;
      if (phase.bothJokersException) {
        assert.equal(phase.active, false, "no swap happens on the two-joker exception");
        assert.equal(getStartingPlayerAfterExchange(state), phase.winnerIdx);
        continue;
      }
      assert.equal(phase.active, true);
      assert.equal(phase.winnerIdx, 0);
      assert.equal(phase.loserIdx, 3);
      assert.ok(
        state.players[0].hand.some((card) => card.id === phase.cardFromLoser.id),
        "the winner received the loser's card"
      );
      assert.ok(
        !state.players[3].hand.some((card) => card.id === phase.cardFromLoser.id),
        "the loser gave it up"
      );
      assert.equal(getStartingPlayerAfterExchange(state), phase.loserIdx);
      assert.equal(
        state.players.reduce((n, p) => n + p.hand.length, 0),
        54,
        "no card is created or lost by the exchange"
      );
    }
  });

  test("loserHasBothJokers and getBestCardFromHand", () => {
    assert.equal(loserHasBothJokers([j("bw"), j("colored"), c("3", "hearts")]), true);
    assert.equal(loserHasBothJokers([j("bw"), c("3", "hearts")]), false);
    assert.equal(getBestCardFromHand([c("3", "hearts"), j("bw"), c("2", "spades")])?.id, "joker_bw");
    assert.equal(getBestCardFromHand([]), undefined);
  });
});
