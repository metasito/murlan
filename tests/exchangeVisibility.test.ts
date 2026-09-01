// tests/exchangeVisibility.test.ts — `visibleExchangePhase` sends
// `cardFromLoser` to the whole table while the phase is active (RULES.md §10.1
// determines it, so it is no one's secret) and `cardToLoser` — which the winner
// chose — to the two of them while it is open, and to the table for as long as
// the ceremony that reads it is on screen.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  markExchangeSettled,
  packPersistedState,
  unpackPersistedState,
  visibleExchangePhase,
} from "../server/onlineGameLogic.ts";
import { exchangeAnnounceMs } from "../lib/exchangeCeremony.ts";
import { STATE_ACK_TIMEOUT_MS } from "../server/gameTimers.ts";
import { readFileSync } from "node:fs";

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

  // `cardToLoser` is a named card out of a named player's hand, and no rule
  // determines it — so while the phase is open it is the winner's secret. What
  // closing the phase changes is not who is entitled to it but what it is: a
  // finished, public fact about the table, which is the same argument #602
  // already made for the other leg.
  describe("the card handed back", () => {
    const RETURNED = { id: "6_clubs", suit: "clubs", rank: "6", isJoker: false };
    const SETTLED_AT = 1_700_000_000_000;
    const settled = {
      ...activePhase,
      active: false,
      cardToLoser: RETURNED,
      settledAt: SETTLED_AT,
    };
    /** Inside the window the announcement is on screen for. */
    const DURING = SETTLED_AT + 1;

    test("the winner sees what they handed back", () => {
      assert.deepEqual(visibleExchangePhase(settled, 1, DURING)?.cardToLoser, RETURNED);
    });

    test("the loser sees what they were handed", () => {
      assert.deepEqual(visibleExchangePhase(settled, 3, DURING)?.cardToLoser, RETURNED);
    });

    // With only one leg, the watching seats animate a delivery rather than a
    // trade.
    test("the watching seats see the trade cross once it is settled", () => {
      for (const seat of [0, 2]) {
        assert.deepEqual(
          visibleExchangePhase(settled, seat, DURING)?.cardToLoser,
          RETURNED,
          `seat ${seat} saw only half the trade`
        );
      }
    });

    test("a viewer with no seat sees it too", () => {
      assert.deepEqual(visibleExchangePhase(settled, null, DURING)?.cardToLoser, RETURNED);
    });

    // `exchangePhase` is never cleared, so the flag alone would keep the card
    // public for the rest of the manche — and hand it to anyone connecting long
    // after the trade, having never watched it cross.
    describe("is bounded to the ceremony that reads it", () => {
      const OVER = SETTLED_AT + exchangeAnnounceMs(false) + STATE_ACK_TIMEOUT_MS;

      // `sendGameStateTo` owes one resend to a client that never acknowledged
      // the settle, and it re-derives from live state when it fires. Answering
      // that with half a trade is what the ack timeout is inside the window for.
      test("the one resend a client is owed still carries the card", () => {
        const resent = SETTLED_AT + exchangeAnnounceMs(false) + STATE_ACK_TIMEOUT_MS - 1;
        assert.deepEqual(visibleExchangePhase(settled, 0, resent)?.cardToLoser, RETURNED);
        assert.ok(
          STATE_ACK_TIMEOUT_MS > 0,
          "the ack timeout is zero, so this case is the ceremony's own end"
        );
      });

      test("a seat arriving after the ceremony is told nothing", () => {
        for (const seat of [0, 2, null]) {
          assert.equal(
            "cardToLoser" in visibleExchangePhase(settled, seat, OVER)!,
            false,
            `seat ${seat} was handed a card it never watched cross`
          );
        }
      });

      // The floor for the assertion above: one millisecond earlier it is there,
      // so the window is a window rather than a gate that is simply shut.
      test("…and one millisecond earlier it is still on screen", () => {
        for (const seat of [0, 2, null]) {
          assert.deepEqual(
            visibleExchangePhase(settled, seat, OVER - 1)?.cardToLoser,
            RETURNED,
            `seat ${seat} lost the card before the ceremony ended`
          );
        }
      });

      test("the two trading keep it for as long as the phase lasts", () => {
        for (const seat of [1, 3]) {
          assert.deepEqual(
            visibleExchangePhase(settled, seat, OVER + 60 * 60_000)?.cardToLoser,
            RETURNED,
            `seat ${seat} lost the card out of its own trade`
          );
        }
      });

      // Both Jokers cancel the flight, so the ceremony is shorter — the window
      // is the ceremony's own clock rather than a number of its own.
      test("the two-joker ceremony closes on its own shorter clock", () => {
        const cancelled = { ...settled, bothJokersException: true };
        const shorter = SETTLED_AT + exchangeAnnounceMs(true) + STATE_ACK_TIMEOUT_MS;
        assert.deepEqual(visibleExchangePhase(cancelled, 0, shorter - 1)?.cardToLoser, RETURNED);
        assert.equal("cardToLoser" in visibleExchangePhase(cancelled, 0, shorter)!, false);
        assert.ok(
          exchangeAnnounceMs(true) < exchangeAnnounceMs(false),
          "the two clocks are the same length, so this proves nothing"
        );
      });

      // A row persisted before the stamp existed, or a phase closed by a path
      // that never broadcast. Nobody watched that one cross either.
      test("a close nobody stamped reads as over", () => {
        const unstamped = { ...settled, settledAt: undefined };
        assert.equal("cardToLoser" in visibleExchangePhase(unstamped, 0, DURING)!, false);
        assert.deepEqual(visibleExchangePhase(unstamped, 1, DURING)?.cardToLoser, RETURNED);
      });

      // The stamp rides the phase into the existing jsonb column rather than a
      // new one, so a restart has to come back inside the window it left in —
      // an envelope that dropped it would silently reopen the exposure instead.
      test("the stamp survives the persisted envelope", () => {
        const stored = packPersistedState({ exchangePhase: settled }, {}, 0, "ABC123", {
          playerMap: { 0: "u" },
          scores: { u: 0 },
          gameMode: "free_for_all",
          matchLength: "match",
          matchTarget: 1,
          maxPlayers: 4,
        });
        const back = unpackPersistedState<{ exchangePhase: typeof settled }>(
          JSON.parse(JSON.stringify(stored))
        );
        assert.ok(back.ok, back.ok ? "" : back.reason);
        assert.equal(back.gameState.exchangePhase.settledAt, SETTLED_AT);
      });
    });

    // The phase closing is what makes it public, so the guard has to be the
    // flag and not merely the card's existence: a state carrying a chosen card
    // while still open must not leak it, however it came about.
    test("an open phase keeps it from everyone but the two trading", () => {
      const leaking = { ...activePhase, cardToLoser: RETURNED };
      for (const seat of [0, 2, null]) {
        assert.equal(
          "cardToLoser" in visibleExchangePhase(leaking, seat)!,
          false,
          `seat ${seat} was shown the winner's card a beat early`
        );
      }
      assert.deepEqual(visibleExchangePhase(leaking, 1)?.cardToLoser, RETURNED);
      assert.deepEqual(visibleExchangePhase(leaking, 3)?.cardToLoser, RETURNED);
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

// The other half of #704's window: the sanitizer reads the stamp, and this is
// what writes it.
describe("markExchangeSettled", () => {
  const NOW = 1_700_000_000_000;

  test("an open phase carries no settle time", () => {
    const phase = { active: true, settledAt: NOW };
    markExchangeSettled(phase, NOW + 5);
    assert.equal("settledAt" in phase, false, "a reopened phase kept the last one's clock");
  });

  test("a closed phase is stamped where it closed", () => {
    const phase: { active: boolean; settledAt?: number } = { active: false };
    markExchangeSettled(phase, NOW);
    assert.equal(phase.settledAt, NOW);
  });

  // Every broadcast runs through this, and the window has to run from the
  // settle rather than from whichever broadcast happened last.
  test("a phase already stamped keeps its own moment", () => {
    const phase = { active: false, settledAt: NOW };
    markExchangeSettled(phase, NOW + 60_000);
    assert.equal(phase.settledAt, NOW, "a later broadcast pushed the window forward");
  });

  test("no phase at all is not an error", () => {
    assert.doesNotThrow(() => markExchangeSettled(undefined, NOW));
  });

  /**
   * The two halves above are each sound on their own, and both stay green if
   * nothing ever calls the writer: the sanitizer would then see an unstamped
   * phase forever and no seat but the two trading would ever be shown the card
   * (docs/agents/RULES.md rule 6).
   *
   * Read off the source because `server/gamePersistence.ts` builds a pg pool at
   * import — the reason these helpers live in `onlineGameLogic.ts` at all.
   */
  test("the broadcast is what stamps it, before it serves any seat", () => {
    const source = readFileSync(
      new URL("../server/gamePersistence.ts", import.meta.url),
      "utf8"
    );
    const body = source.slice(source.indexOf("export function broadcastGameState"));
    const stamp = body.indexOf("markExchangeSettled(");
    const firstSend = body.indexOf("sendGameStateTo(");
    assert.ok(stamp >= 0, "broadcastGameState no longer stamps the settle time");
    assert.ok(
      firstSend >= 0 && stamp < firstSend,
      "a seat is served before the settle is stamped, so it is told nothing"
    );
  });
});
