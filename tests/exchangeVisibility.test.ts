// tests/exchangeVisibility.test.ts — `visibleExchangePhase` sends
// `cardFromLoser` to the whole table while the phase is active (RULES.md §10.1
// determines it, so it is no one's secret) and `cardToLoser` — which the winner
// chose — to the two of them alone.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { visibleExchangePhase } from "../server/onlineGameLogic.ts";

const CARD = { id: "2_spades", suit: "spades", rank: "2", isJoker: false };

const activePhase = {
  active: true,
  winnerIdx: 1,
  loserIdx: 3,
  bothJokersException: false,
  cardFromLoser: CARD,
};

describe("visibleExchangePhase", () => {
  test("the winner sees the card they were handed", () => {
    assert.deepEqual(visibleExchangePhase(activePhase, 1)?.cardFromLoser, CARD);
  });

  test("the loser sees the card taken off them", () => {
    assert.deepEqual(visibleExchangePhase(activePhase, 3)?.cardFromLoser, CARD);
  });

  // #602: the card has to be on the felt for every seat, not just the two
  // trading. Watching a trade you cannot see is the defect that ticket names.
  test("the seats watching see it too", () => {
    for (const seat of [0, 2]) {
      assert.deepEqual(
        visibleExchangePhase(activePhase, seat)?.cardFromLoser,
        CARD,
        `seat ${seat} was not shown the card`
      );
    }
  });

  test("a viewer with no seat (spectator, unknown user) sees it", () => {
    assert.deepEqual(visibleExchangePhase(activePhase, null)?.cardFromLoser, CARD);
  });

  test("the card stops being sent once the phase closes, at every seat", () => {
    const closed = { ...activePhase, active: false };
    for (const seat of [0, 1, 2, 3, null]) {
      assert.equal(
        "cardFromLoser" in visibleExchangePhase(closed, seat)!,
        false,
        `seat ${seat} was still being sent the card`
      );
    }
  });

  test("everything the announcement banner reads is still sent to everyone", () => {
    for (const seat of [0, 1, 2, 3]) {
      assert.deepEqual(
        { ...visibleExchangePhase(activePhase, seat), cardFromLoser: undefined },
        {
          active: true,
          winnerIdx: 1,
          loserIdx: 3,
          bothJokersException: false,
          cardFromLoser: undefined,
        }
      );
    }
  });

  test("no phase at all stays absent", () => {
    assert.equal(visibleExchangePhase(undefined, 0), undefined);
  });

  // `cardToLoser` is the other half of the same secret: a named card out of a
  // named player's hand. It exists only once the winner has chosen, which is
  // the same moment the phase closes — so unlike `cardFromLoser` it cannot be
  // gated on `active`, and its own presence is what gates it.
  describe("the card handed back", () => {
    const RETURNED = { id: "6_clubs", suit: "clubs", rank: "6", isJoker: false };
    const settled = { ...activePhase, active: false, cardToLoser: RETURNED };

    test("the winner sees what they handed back", () => {
      assert.deepEqual(visibleExchangePhase(settled, 1)?.cardToLoser, RETURNED);
    });

    test("the loser sees what they were handed", () => {
      assert.deepEqual(visibleExchangePhase(settled, 3)?.cardToLoser, RETURNED);
    });

    test("uninvolved seats never receive it", () => {
      for (const seat of [0, 2]) {
        const visible = visibleExchangePhase(settled, seat);
        assert.equal("cardToLoser" in visible!, false, `seat ${seat} was told the card`);
      }
    });

    test("a viewer with no seat receives nothing", () => {
      assert.equal("cardToLoser" in visibleExchangePhase(settled, null)!, false);
    });

    // The floor: with nothing chosen there is nothing to reveal, so the key is
    // absent rather than present and undefined — including for the two people
    // who are entitled to it.
    test("is absent from every view before the winner chooses", () => {
      for (const seat of [0, 1, 2, 3, null]) {
        assert.equal(
          "cardToLoser" in visibleExchangePhase(activePhase, seat)!,
          false,
          `seat ${seat} was told a card that had not been chosen`
        );
      }
    });
  });

  test("the two-joker exception is visible to the table", () => {
    const both = { ...activePhase, active: false, bothJokersException: true };
    assert.equal(visibleExchangePhase(both, 0)?.bothJokersException, true);
  });
});
