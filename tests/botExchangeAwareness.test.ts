// tests/botExchangeAwareness.test.ts — the exchange reveals the loser's own
// former best card, now in the winner's hand, and a bot that ignores it can
// lead straight into the hand it knows can beat it (#907).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  aiChoosePlay,
  buildCombination,
  getRankStrength,
  knownOpponentExchangeCard,
  RANK_SLOTS,
} from "../lib/gameEngine.ts";
import { autoMoveForSeat } from "../lib/autoMove.ts";
import { c, makePlayer, makeState } from "./helpers.ts";
import type { ExchangePhase } from "./helpers.ts";

const exchange = (
  winnerIdx: number,
  loserIdx: number,
  overrides: Partial<ExchangePhase> = {}
): ExchangePhase => ({
  active: false,
  winnerIdx,
  loserIdx,
  cardFromLoser: c("4", "hearts"),
  bothJokersException: false,
  ...overrides,
});

describe("knownOpponentExchangeCard", () => {
  test("the loser learns what it gave away — now the winner's", () => {
    const phase = exchange(0, 1, { cardFromLoser: c("6", "clubs") });
    assert.equal(knownOpponentExchangeCard(phase, 1)?.id, "6_clubs");
  });

  test("the winner learns nothing — its own giveback can never be led under", () => {
    const phase = exchange(0, 1, { cardToLoser: c("5", "spades") });
    assert.equal(knownOpponentExchangeCard(phase, 0), undefined);
  });

  test("the both-jokers exception moves no card, so the loser learns nothing", () => {
    const phase = exchange(0, 1, { bothJokersException: true, cardFromLoser: c("2", "spades") });
    assert.equal(knownOpponentExchangeCard(phase, 1), undefined);
  });

  test("a seat outside the exchange (a teammate) learns nothing", () => {
    const phase = exchange(0, 1);
    assert.equal(knownOpponentExchangeCard(phase, 2), undefined);
  });

  test("no exchange this manche means no known card", () => {
    assert.equal(knownOpponentExchangeCard(undefined, 1), undefined);
  });
});

describe("every tier: never lead the exact card known to lose", () => {
  for (const personality of ["luan", "besnik", "gent"] as const) {
    test(`${personality} leads the safe alternative instead of the known-beaten card`, () => {
      const hand = [c("4", "hearts"), c("9", "clubs")];
      const me = makePlayer("me", hand, { type: "ai", personality });
      const knownOpponentCard = c("6", "spades");

      const choice = aiChoosePlay(
        me, null, true, [8], undefined, () => 0.5, false, undefined, knownOpponentCard
      );

      assert.ok(choice, "a bot on lead must always play something");
      assert.equal(choice!.cards[0].rank, "9", "led the 4 straight into the known 6");
    });

    test(`${personality} still leads something when every play loses to the known card`, () => {
      const hand = [c("4", "hearts"), c("5", "clubs")];
      const me = makePlayer("me", hand, { type: "ai", personality });
      const knownOpponentCard = c("9", "spades");

      const choice = aiChoosePlay(
        me, null, true, [8], undefined, () => 0.5, false, undefined, knownOpponentCard
      );

      assert.ok(choice, "no safe lead exists, but a new round cannot be passed");
    });
  }

  test("responding is not leading — the filter does not touch an answer to a play", () => {
    const hand = [c("4", "hearts"), c("9", "clubs")];
    const me = makePlayer("me", hand, { type: "ai", personality: "besnik" });
    const lastPlayed = buildCombination([c("3", "diamonds")])!;
    const knownOpponentCard = c("6", "spades");

    const withKnown = aiChoosePlay(
      me, lastPlayed, false, [8], undefined, () => 0.5, false, undefined, knownOpponentCard
    );
    const without = aiChoosePlay(
      me, lastPlayed, false, [8], undefined, () => 0.5, false, undefined, undefined
    );

    assert.equal(withKnown?.cards[0].id, without?.cards[0].id);
  });

  test("a known card already spent no longer bends the lead — it is stale", () => {
    const hand = [c("4", "hearts"), c("9", "clubs")];
    const me = makePlayer("me", hand, { type: "ai", personality: "luan" });
    const knownOpponentCard = c("6", "spades");
    // All four 6s accounted for by the public tally: the opponent cannot
    // still be holding the one the exchange gave it.
    const playedRanks = new Array<number>(RANK_SLOTS).fill(0);
    playedRanks[getRankStrength("6")] = 4;

    const choice = aiChoosePlay(
      me, null, true, [8], undefined, () => 0.5, false, playedRanks, knownOpponentCard
    );

    assert.equal(choice?.cards[0].rank, "4", "avoided a card that was already gone");
  });
});

describe("autoMoveForSeat wires the exchange into the loser that leads next", () => {
  test("the loser does not lead under its own former card now in the winner's hand", () => {
    const state = makeState(
      [
        makePlayer("winner", [c("9", "clubs"), c("K", "hearts")], { type: "ai", personality: "luan" }),
        makePlayer("loser", [c("4", "hearts"), c("Q", "spades")], { type: "ai", personality: "luan" }),
      ],
      {
        currentTurnIndex: 1,
        lastPlayedBy: 1,
        firstPlayMade: true,
        exchangePhase: exchange(0, 1, { cardFromLoser: c("6", "diamonds") }),
      }
    );

    const next = autoMoveForSeat(state, 1, true, { rng: () => 0.5 });

    assert.ok(next, "the loser must lead something");
    const played = state.players[1].hand.filter(
      (card) => !next!.players[1].hand.some((left) => left.id === card.id)
    );
    assert.equal(played.length, 1);
    assert.equal(played[0].rank, "Q", "led the 4 into the winner's known 6");
  });
});
