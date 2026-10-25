import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { card as c, joker as j, seat as makePlayer, state as makeState } from "../support/game.ts";
import {
  actingSeat,
  exchangeIsSatisfiable,
  getValidGivebackCards,
  openingAfter,
  startRound,
  type Card,
} from "../../lib/game/gameEngine.ts";
import { givenBack, refusalOf } from "../support/moves.ts";
import { autoMoveForSeat } from "../../lib/game/autoMove.ts";

const ids = (cards: Card[]) => cards.map((card) => card.id).sort();
const FIRST_BEAT_LAST = { kind: "exchange", winnerSeat: 0, loserSeat: 3 } as const;

describe("getValidGivebackCards (defect 7)", () => {
  test("primary rule: any card ranked 3 to 10", () => {
    const hand = [
      c("3", "spades"), c("10", "hearts"), c("J", "clubs"),
      c("A", "diamonds"), c("2", "spades"), j("bw"),
    ];
    assert.deepEqual(ids(getValidGivebackCards(hand)), ids([c("3", "spades"), c("10", "hearts")]));
  });

  test("a hand with no 3-10 card has nothing to give", () => {
    const hand = [c("K", "clubs"), c("J", "hearts"), c("A", "spades"), j("colored")];
    assert.deepEqual(getValidGivebackCards(hand), []);
  });

  test("empty hand yields no choices and does not crash", () => {
    assert.deepEqual(getValidGivebackCards([]), []);
  });
});

describe("processExchangeChoice", () => {
  const buildState = (winnerHand: Card[], loserHand: Card[]) =>
    makeState(
      { players: [makePlayer(0, winnerHand), makePlayer(1, loserHand)],
        currentTurnIndex: 0,
        lastPlayedBy: 0,
        exchangePhase: { kind: "open", winnerIdx: 0, loserIdx: 1, cardFromLoser: c("2", "spades") },
      }
    );

  test("moves the chosen card and hands the lead to the loser", () => {
    const state = buildState([c("4", "hearts"), c("K", "spades")], [c("9", "clubs")]);
    const next = givenBack(state, "4_hearts");
    assert.deepEqual(next.players[0].hand.map((card) => card.id), ["K_spades"]);
    assert.ok(next.players[1].hand.some((card) => card.id === "4_hearts"));
    assert.equal(next.exchangePhase?.kind, "settled");
    assert.equal(next.currentTurnIndex, 1, "the loser leads the new round");
    assert.equal(next.lastPlayedBy, 1);
  });

  // Online the loser's hand is sanitized out of every other view, so the phase
  // itself is the only place the return leg is written down.
  test("records the card it handed back", () => {
    const state = buildState([c("4", "hearts"), c("K", "spades")], [c("9", "clubs")]);
    const next = givenBack(state, "4_hearts");
    assert.deepEqual(next.exchangePhase, {
      kind: "settled",
      winnerIdx: 0,
      loserIdx: 1,
      cardFromLoser: c("2", "spades"),
      cardToLoser: c("4", "hearts"),
    });
  });

  test("records nothing while the winner has not chosen", () => {
    const state = buildState([c("4", "hearts")], [c("9", "clubs")]);
    assert.equal(state.exchangePhase?.kind, "open");
    assert.equal("cardToLoser" in state.exchangePhase!, false);
  });

  // The floor: a rejected choice moves no card, so it must leave no record of
  // one — a phase naming a card that never changed hands is worse than a phase
  // naming nothing.
  test("records nothing when the choice is rejected", () => {
    const state = buildState([c("4", "hearts"), c("K", "spades")], [c("9", "clubs")]);
    const before = structuredClone(state);
    assert.equal(refusalOf(state, { kind: "giveback", cardId: "K_spades" }), "notGiveable");
    assert.deepEqual(state, before);
  });

  test("rejects a card outside 3-10 while a legal one exists", () => {
    const state = buildState([c("4", "hearts"), c("K", "spades")], [c("9", "clubs")]);
    assert.equal(refusalOf(state, { kind: "giveback", cardId: "K_spades" }), "notGiveable");
  });

  test("rejects a card the winner does not hold", () => {
    const state = buildState([c("4", "hearts")], [c("9", "clubs")]);
    assert.equal(refusalOf(state, { kind: "giveback", cardId: "7_clubs" }), "notHeld");
  });

  const withReceived = (winnerHand: Card[], received: Card) =>
    makeState(
      { players: [makePlayer(0, winnerHand), makePlayer(1, [c("4", "clubs")])],
        currentTurnIndex: 0,
        lastPlayedBy: 0,
        exchangePhase: { kind: "open", winnerIdx: 0, loserIdx: 1, cardFromLoser: received },
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
    assert.equal(refusalOf(state, { kind: "giveback", cardId: received.id }), "notGiveable");
  });

  test("the received card, as the only 3-10 card, leaves nothing to give", () => {
    const received = c("8", "hearts");
    assert.deepEqual(getValidGivebackCards([j("bw"), j("colored"), received], received.id), []);
  });

  test("does nothing when no exchange is open", () => {
    const state = makeState({ players: [makePlayer(0, [c("4", "hearts")]), makePlayer(1, [])] });
    assert.equal(refusalOf(state, { kind: "giveback", cardId: "4_hearts" }), "noExchange");
  });
});

// #784 — `autoMoveForSeat` re-asks whichever seat `exchangePhase.winnerIdx`
// still names for as long as the phase stays open. A correct
// `processExchangeChoice` clears it on the winner's first giveback
// (docs/GAME-RULES.md §10 allows exactly one), so this drives the same seat
// through `autoMoveForSeat` — never `processExchangeChoice` directly — until
// the phase closes, counting every card it hands over along the way.
describe("REGRESSION (#784): the exchange closes after exactly one giveback", () => {
  test("the winner is not re-asked", () => {
    const winnerHand = [c("3", "hearts"), c("4", "clubs")];
    let state = makeState(
      { players: [makePlayer(0, winnerHand), makePlayer(1, [c("9", "clubs")])],
        currentTurnIndex: 0,
        lastPlayedBy: 0,
        exchangePhase: { kind: "open", winnerIdx: 0, loserIdx: 1, cardFromLoser: c("2", "spades") },
      }
    );

    let givebacks = 0;
    for (let i = 0; i < winnerHand.length + 2 && state.exchangePhase?.kind === "open"; i++) {
      const auto = autoMoveForSeat(state, 0, "floor");
      assert.ok(auto, "seat 0 is exchangePhase.winnerIdx and must always be able to act");
      if (auto.move.kind === "giveback") givebacks++;
      state = auto.state;
    }

    assert.equal(
      givebacks,
      1,
      `seat 0 gave back a card ${givebacks} time(s) in one exchange, not 1 ` +
        `(hand drained to ${state.players[0].hand.length} card(s))`
    );
    assert.equal(state.exchangePhase?.kind, "settled", "the exchange must be closed after the winner's one giveback");
  });
});

describe("exchangeIsSatisfiable", () => {
  const open = (winnerHand: Card[]) =>
    makeState({
      players: [makePlayer(0, winnerHand), makePlayer(1, [c("9", "clubs")])],
      exchangePhase: { kind: "open", winnerIdx: 0, loserIdx: 1, cardFromLoser: c("A", "spades") },
    });

  test("an open exchange is satisfiable while the winner holds a 3-10 card other than the one received", () => {
    assert.equal(exchangeIsSatisfiable(open([c("4", "hearts")])), true);
    assert.equal(exchangeIsSatisfiable(open([c("K", "hearts")])), false);
    assert.equal(exchangeIsSatisfiable(open([])), false);
    assert.equal(exchangeIsSatisfiable(open([c("A", "spades")])), false);
  });

  test("a closed exchange, or none, has nothing to satisfy", () => {
    assert.equal(exchangeIsSatisfiable(makeState()), true);
    const settled = { kind: "settled", winnerIdx: 0, loserIdx: 1, cardFromLoser: c("A", "spades"), cardToLoser: c("4", "clubs") } as const;
    assert.equal(exchangeIsSatisfiable({ ...open([]), exchangePhase: settled }), true);
  });
});

describe("round-to-round exchange setup", () => {
  const setup = [0, 1, 2, 3].map((i) => ({ name: `p${i}`, type: "human" as const }));

  test("the loser's highest card moves to the winner and the loser leads", () => {
    for (let i = 0; i < 50; i++) {
      const state = startRound(setup, "free_for_all", { opening: FIRST_BEAT_LAST });
      const phase = state.exchangePhase!;
      if (phase.kind === "twoJokers") {
        assert.equal(actingSeat(state), phase.winnerIdx);
        continue;
      }
      assert.equal(phase.kind, "open");
      assert.equal(phase.winnerIdx, 0);
      assert.equal(phase.loserIdx, 3);
      const given = phase.cardFromLoser;
      assert.ok(
        state.players[0].hand.some((card) => card.id === given.id),
        "the winner received the loser's card"
      );
      assert.ok(
        !state.players[3].hand.some((card) => card.id === given.id),
        "the loser gave it up"
      );
      const settled = givenBack(state, getValidGivebackCards(state.players[0].hand, given.id)[0].id);
      assert.equal(actingSeat(settled), phase.loserIdx, "the loser leads once the winner gives back");
      assert.equal(
        state.players.reduce((n, p) => n + p.hand.length, 0),
        54,
        "no card is created or lost by the exchange"
      );
    }
  });

  const fixedDeal = (loserHand: Card[]) =>
    startRound(
      [0, 1, 2, 3].map((i) => ({ name: `p${i}`, type: "human" as const })),
      "free_for_all",
      {
        opening: FIRST_BEAT_LAST,
        dealt: [[c("3", "spades"), c("4", "hearts")], [c("5", "clubs")], [c("7", "hearts")], loserHand],
      }
    ).exchangePhase!;

  test("a loser holding one joker is no exception, and hands over its best card", () => {
    const phase = fixedDeal([c("3", "hearts"), j("bw"), c("2", "spades")]);
    assert.equal(phase.kind, "open");
    assert.equal(phase.kind === "open" && phase.cardFromLoser.id, "joker_bw");
  });

  test("a loser holding both jokers among other cards is the exception", () => {
    const phase = fixedDeal([j("bw"), j("colored"), c("3", "hearts")]);
    assert.deepEqual(phase, { kind: "twoJokers", winnerIdx: 0, loserIdx: 3 });
  });
});

describe("a winner with nothing to give, on a fixed deal", () => {
  const setup = [0, 1].map((i) => ({ name: `p${i}`, type: "bot" as const }));
  const hands: Card[][] = [
    [c("K", "clubs"), c("A", "spades"), j("bw")],
    [c("4", "hearts"), c("10", "diamonds"), c("Q", "hearts")],
  ];
  const deal = () => startRound(setup, "free_for_all", { opening: { kind: "exchange", winnerSeat: 0, loserSeat: 1 }, dealt: hands });

  test("the exchange settles one-way and the loser leads", () => {
    const state = deal();
    assert.deepEqual(state.exchangePhase, { kind: "settled", winnerIdx: 0, loserIdx: 1, cardFromLoser: c("Q", "hearts") });
    assert.deepEqual(ids(state.players[0].hand), ids([...hands[0], c("Q", "hearts")]));
    assert.deepEqual(ids(state.players[1].hand), ids([c("4", "hearts"), c("10", "diamonds")]));
    assert.equal(actingSeat(state), 1);
    assert.equal(state.startReason?.type, "lost_round");
  });

  test("no giveback is asked of the winner, and the loser's bot plays", () => {
    const state = deal();
    assert.equal(refusalOf(state, { kind: "giveback", cardId: "K_clubs" }), "noExchange");
    assert.equal(autoMoveForSeat(state, 0, "bot"), null);
    assert.equal(autoMoveForSeat(state, 1, "bot")?.move.kind, "play");
  });
});

describe("the two-joker exception, on a fixed deal", () => {
  const setup = [0, 1, 2, 3].map((i) => ({ name: `p${i}`, type: "human" as const }));
  const hands: Card[][] = [
    [c("3", "spades"), c("4", "hearts")],
    [c("5", "clubs"), c("6", "diamonds")],
    [c("7", "hearts"), c("8", "clubs")],
    [j("colored"), j("bw")],
  ];

  test("no card moves, the winner leads, and the phase is closed", () => {
    const state = startRound(setup, "free_for_all", { opening: FIRST_BEAT_LAST, dealt: hands });
    const phase = state.exchangePhase!;
    assert.deepEqual(phase, { kind: "twoJokers", winnerIdx: 0, loserIdx: 3 }, "no card moved, so none is recorded as given");
    assert.equal(state.currentTurnIndex, phase.winnerIdx);
    assert.equal(actingSeat(state), phase.winnerIdx);
    assert.equal(state.startReason?.type, "won_no_exchange");
    assert.deepEqual(
      state.players.map((p) => ids(p.hand)),
      hands.map(ids),
      "no hand changed"
    );
  });
});

describe("a dealt rematch is checked like a dealt first round", () => {
  const setup = [0, 1].map((i) => ({ name: `p${i}`, type: "human" as const }));
  const opening = { kind: "exchange", winnerSeat: 0, loserSeat: 1 } as const;

  test("a card dealt twice is refused", () => {
    assert.throws(
      () => startRound(setup, "free_for_all", { opening, dealt: [[c("4", "hearts")], [c("4", "hearts")]] }),
      /card 4_hearts is dealt twice/
    );
  });

  test("a deal for the wrong number of seats is refused", () => {
    assert.throws(
      () => startRound(setup, "free_for_all", { opening, dealt: [[c("4", "hearts")]] }),
      /a deal for 2 seats has 1 hands/
    );
  });
});

describe("an exchange opening names two seats at the table", () => {
  const setup = [0, 1, 2].map((i) => ({ name: `p${i}`, type: "human" as const }));

  for (const [winnerSeat, loserSeat] of [[0, 3], [-1, 2], [1, 1], [0.5, 2]]) {
    test(`winner ${winnerSeat}, loser ${loserSeat} is refused rather than guessed at`, () => {
      assert.throws(
        () => startRound(setup, "free_for_all", { opening: { kind: "exchange", winnerSeat, loserSeat } }),
        /no exchange between seats/
      );
    });
  }
});

describe("the opening after a round", () => {
  const finished = (finishingOrder: string[]) =>
    makeState({ players: [0, 1, 2].map((i) => makePlayer(i, [], { id: `player_${i}` })), roundOver: true, finishingOrder });

  test("a round every seat finished opens the next with its winner and loser exchanging", () => {
    assert.deepEqual(openingAfter(finished(["player_2", "player_0", "player_1"])), {
      kind: "exchange",
      winnerSeat: 2,
      loserSeat: 1,
    });
  });

  test("a round left part-ranked opens with the 3♠", () => {
    assert.deepEqual(openingAfter(finished(["player_2"])), { kind: "startCard" });
  });
});
