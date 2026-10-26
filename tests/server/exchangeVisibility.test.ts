// tests/server/exchangeVisibility.test.ts — `visibleExchangePhase` sends
// `cardFromLoser` to the whole table while the phase is open (GAME-RULES.md §10.1
// determines it, so it is no one's secret) and `cardToLoser` — which the winner
// chose — to the two of them while it is open, and to the table for as long as
// the ceremony that reads it is on screen.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { markExchangeSettled, visibleExchangePhase } from "../../server/game/onlineGameLogic.ts";
import { packPersistedState, unpackPersistedState } from "../../shared/persistedEnvelope.ts";
import { exchangeAnnounceMs } from "../../lib/timeline/exchangeTimeline.ts";
import { stateAckTimeoutMs } from "../../server/game/gameTimers.ts";
import type { ExchangePhase } from "../../lib/game/gameEngine.ts";
import { card, state } from "../support/game.ts";

/** Any instant: these phases carry no settle stamp, so no ceremony is measured. */
const AT = 1_700_000_000_000;
const CARD = card("2", "spades");

const openPhase: Extract<ExchangePhase, { kind: "open" }> = { kind: "open", winnerIdx: 1, loserIdx: 3, cardFromLoser: CARD };
const fromLoser = (seat: number | null) => {
  const view = visibleExchangePhase(openPhase, seat, AT);
  return view?.kind === "open" ? view.cardFromLoser : undefined;
};

describe("visibleExchangePhase", () => {
  test("the winner sees the card they were handed", () => {
    assert.deepEqual(fromLoser(1), CARD);
  });

  test("the loser sees the card taken off them", () => {
    assert.deepEqual(fromLoser(3), CARD);
  });

  // #602: the card has to be on the felt for every seat, not just the two
  // exchanging. Watching an exchange you cannot see is the defect that ticket names.
  test("the seats watching see it too", () => {
    for (const seat of [0, 2]) {
      assert.deepEqual(
        fromLoser(seat),
        CARD,
        `seat ${seat} was not shown the card`
      );
    }
  });

  test("a viewer with no seat (spectator, unknown user) sees it", () => {
    assert.deepEqual(fromLoser(null), CARD);
  });

  test("the card stops being sent once the phase closes, at every seat", () => {
    const closed: ExchangePhase = { ...openPhase, kind: "settled", cardToLoser: card("6", "clubs") };
    for (const seat of [0, 1, 2, 3, null]) {
      assert.equal(
        "cardFromLoser" in visibleExchangePhase(closed, seat, AT)!,
        false,
        `seat ${seat} was still being sent the card`
      );
    }
  });

  test("a one-way exchange, with nothing handed back, names no card handed back and sends the taken card to every seat", () => {
    const oneWay: ExchangePhase = { ...openPhase, kind: "settled", settledAt: AT };
    for (const seat of [0, 1, 2, 3, null]) {
      assert.deepEqual(
        visibleExchangePhase(oneWay, seat, AT + 1),
        { kind: "settled", winnerIdx: 1, loserIdx: 3, cardFromLoser: CARD },
        `seat ${seat}`
      );
    }
  });

  test("a one-way exchange keeps sending the taken card for as long as the round stands, not only for its ceremony", () => {
    const oneWay: ExchangePhase = { ...openPhase, kind: "settled", settledAt: AT };
    for (const seat of [0, 1, 2, 3, null]) {
      assert.deepEqual(visibleExchangePhase(oneWay, seat, AT + 60 * 60_000), visibleExchangePhase(oneWay, seat, AT + 1), `seat ${seat}`);
    }
  });

  test("everything the announcement banner reads is still sent to everyone", () => {
    for (const seat of [0, 1, 2, 3]) {
      assert.deepEqual(
        { ...visibleExchangePhase(openPhase, seat, AT), cardFromLoser: undefined },
        { kind: "open", winnerIdx: 1, loserIdx: 3, cardFromLoser: undefined }
      );
    }
  });

  test("no phase at all stays absent", () => {
    assert.equal(visibleExchangePhase(undefined, 0, AT), undefined);
  });

  // `cardToLoser` is a named card out of a named player's hand, and no rule
  // determines it — so while the phase is open it is the winner's secret. What
  // closing the phase changes is not who is entitled to it but what it is: a
  // finished, public fact about the table, which is the same argument #602
  // already made for the other leg.
  describe("the card handed back", () => {
    const RETURNED = card("6", "clubs");
    const SETTLED_AT = 1_700_000_000_000;
    const settled: ExchangePhase = { ...openPhase, kind: "settled", cardToLoser: RETURNED, settledAt: SETTLED_AT };
    const shown = (phase: ExchangePhase, seat: number | null, now: number) => {
      const view = visibleExchangePhase(phase, seat, now);
      return view?.kind === "settled" ? view.cardToLoser : undefined;
    };
    const told = (phase: ExchangePhase, seat: number | null, now: number) =>
      "cardToLoser" in visibleExchangePhase(phase, seat, now)!;
    /** Inside the window the announcement is on screen for. */
    const DURING = SETTLED_AT + 1;

    test("the winner sees what they handed back", () => {
      assert.deepEqual(shown(settled, 1, DURING), RETURNED);
    });

    test("the loser sees what they were handed", () => {
      assert.deepEqual(shown(settled, 3, DURING), RETURNED);
    });

    // With only one leg, the watching seats animate a delivery rather than a
    // exchange.
    test("the watching seats see the announced cross once it is settled", () => {
      for (const seat of [0, 2]) {
        assert.deepEqual(
          shown(settled, seat, DURING),
          RETURNED,
          `seat ${seat} saw only half the announced`
        );
      }
    });

    test("a viewer with no seat sees it too", () => {
      assert.deepEqual(shown(settled, null, DURING), RETURNED);
    });

    // `exchangePhase` is never cleared, so the flag alone would keep the card
    // public for the rest of the round — and hand it to anyone connecting long
    // after the exchange, having never watched it cross.
    describe("is bounded to the ceremony that reads it", () => {
      const OVER = SETTLED_AT + exchangeAnnounceMs(false);

      /**
       * `sendGameStateTo` owes one resend to a client that never acknowledged
       * the settle, and that resend re-derives from live state when it fires.
       * If the ack timeout ever outgrew the window it would be answered with
       * half an exchange, and `exchangeAnnouncementOf` raises that as a
       * one-legged ceremony rather than refusing it.
       *
       * Asserted here rather than added to the window in `onlineGameLogic.ts`:
       * `gameTimers` reads `process.env` at module scope, and importing it into
       * that module puts it in the static graph of every integration test that
       * sets one of those variables in its own body — where the imports have
       * already run. Doing exactly that made `MURLAN_DISCONNECT_GRACE_MS` take
       * its 60s default and hung `sessionReplaced.test.ts`.
       *
       * The two-Joker window is shorter than the ack timeout and does not need
       * to be: that exception cancels the exchange, so no card is ever chosen and
       * `cardToLoser` stays absent.
       */
      test("the resend a client is owed lands inside the window", () => {
        assert.ok(
          stateAckTimeoutMs() < exchangeAnnounceMs(false),
          `the state-ack resend (${stateAckTimeoutMs()}ms) now fires after the ceremony ` +
            `(${exchangeAnnounceMs(false)}ms), so a client that missed the settle is re-sent ` +
            `half a announced`
        );
      });

      test("a seat arriving after the ceremony is told nothing", () => {
        for (const seat of [0, 2, null]) {
          assert.equal(
            told(settled, seat, OVER),
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
            shown(settled, seat, OVER - 1),
            RETURNED,
            `seat ${seat} lost the card before the ceremony ended`
          );
        }
      });

      test("the two trading keep it for as long as the phase lasts", () => {
        for (const seat of [1, 3]) {
          assert.deepEqual(
            shown(settled, seat, OVER + 60 * 60_000),
            RETURNED,
            `seat ${seat} lost the card out of its own announced`
          );
        }
      });

      // A row persisted before the stamp existed, or a phase closed by a path
      // that never broadcast. Nobody watched that one cross either.
      test("a close nobody stamped reads as over", () => {
        const unstamped: ExchangePhase = { ...settled, settledAt: undefined };
        assert.equal(told(unstamped, 0, DURING), false);
        assert.deepEqual(shown(unstamped, 1, DURING), RETURNED);
      });

      // The stamp rides the phase into the existing jsonb column rather than a
      // new one, so a restart has to come back inside the window it left in —
      // an envelope that dropped it would silently reopen the exposure instead.
      test("the stamp survives the persisted envelope", () => {
        const stored = packPersistedState(state({ exchangePhase: settled }), {}, 0, "ABC123", {
          playerMap: { 0: "u" },
          scores: { u: 0 },
          endedByVote: false,
          matchOver: false,
          gameMode: "free_for_all",
          matchLength: "match",
          roundsPlayed: 0,
          matchTarget: 1,
          maxPlayers: 4,
        }, { vacatedSeats: [], releasedSeats: [], weakSeats: [], abandonedSeats: [] });
        const back = unpackPersistedState(
          JSON.parse(JSON.stringify(stored))
        );
        assert.ok(back.ok, back.ok ? "" : back.reason);
        assert.deepEqual(back.gameState.exchangePhase, settled);
      });
    });

    // The floor: with nothing chosen there is nothing to reveal, so the key is
    // absent rather than present and undefined — including for the two people
    // who are entitled to it.
    test("is absent from every view before the winner chooses", () => {
      for (const seat of [0, 1, 2, 3, null]) {
        assert.equal(
          told(openPhase, seat, AT),
          false,
          `seat ${seat} was told a card that had not been chosen`
        );
      }
    });
  });

  test("the two-joker exception is visible to the table, and nothing else is", () => {
    for (const seat of [0, 1, 3, null]) {
      assert.deepEqual(visibleExchangePhase({ kind: "twoJokers", winnerIdx: 1, loserIdx: 3 }, seat, AT), {
        kind: "twoJokers",
        winnerIdx: 1,
        loserIdx: 3,
      });
    }
  });
});

// The other half of #704's window: the sanitizer reads the stamp, and this is
// what writes it.
describe("markExchangeSettled", () => {
  const NOW = 1_700_000_000_000;

  const CHOSEN = card("6", "clubs");

  test("only a settled phase is stamped", () => {
    for (const phase of [openPhase, { kind: "twoJokers", winnerIdx: 1, loserIdx: 3 } as const]) {
      const before = structuredClone(phase);
      markExchangeSettled(phase, NOW);
      assert.deepEqual(phase, before, `a ${phase.kind} phase was stamped`);
    }
  });

  test("a closed phase is stamped where it closed", () => {
    const phase: ExchangePhase = { ...openPhase, kind: "settled", cardToLoser: CHOSEN };
    markExchangeSettled(phase, NOW);
    assert.equal(phase.settledAt, NOW);
  });

  // Every broadcast runs through this, and the window has to run from the
  // settle rather than from whichever broadcast happened last.
  test("a phase already stamped keeps its own moment", () => {
    const phase: ExchangePhase = { ...openPhase, kind: "settled", cardToLoser: CHOSEN, settledAt: NOW };
    markExchangeSettled(phase, NOW + 60_000);
    assert.equal(phase.settledAt, NOW, "a later broadcast pushed the window forward");
  });

  test("no phase at all is not an error", () => {
    assert.doesNotThrow(() => markExchangeSettled(undefined, NOW));
  });
});
