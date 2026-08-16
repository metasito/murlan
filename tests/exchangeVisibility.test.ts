// tests/exchangeVisibility.test.ts — `sanitizeStateForPlayer` used to spread
// exchangePhase verbatim into every seat's game:state, so `cardFromLoser` (a
// named card out of a named player's hand) reached the whole table, and kept
// being sent long after the phase had closed. Only the winner and the loser
// have any use for it, and only while the phase is open.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore — .ts extension required by Node's type-stripping loader
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

  test("uninvolved seats never receive the card", () => {
    for (const seat of [0, 2]) {
      const visible = visibleExchangePhase(activePhase, seat);
      assert.ok(visible);
      assert.equal("cardFromLoser" in visible!, false, `seat ${seat} was told the card`);
    }
  });

  test("a viewer with no seat (spectator, unknown user) receives nothing", () => {
    const visible = visibleExchangePhase(activePhase, null);
    assert.equal("cardFromLoser" in visible!, false);
  });

  test("the card stops being sent once the phase closes, even to the winner", () => {
    const closed = { ...activePhase, active: false };
    assert.equal("cardFromLoser" in visibleExchangePhase(closed, 1)!, false);
    assert.equal("cardFromLoser" in visibleExchangePhase(closed, 3)!, false);
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

  test("the two-joker exception is visible to the table", () => {
    const both = { ...activePhase, active: false, bothJokersException: true };
    assert.equal(visibleExchangePhase(both, 0)?.bothJokersException, true);
  });
});
