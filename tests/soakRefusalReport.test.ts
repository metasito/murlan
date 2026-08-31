// tests/soakRefusalReport.test.ts — a soak run that was refused has to say what
// it was refused with.
//
// #603 was answered by elimination: a run reported "7 refusals" and naming them
// meant cross-reading the server log for the two refusal kinds that happened to
// log, and calling the remainder `RATE_LIMITED` because nothing else was left.
// A count is not a diagnosis. The run's own summary carries the events and the
// codes now, and this pins that it still does — no database, because the
// bookkeeping is the claim, not the game.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Seat, formatRefusals, REFUSAL_EVENTS } from "./soak/soak.ts";
import { getValidGivebackCards, type Card } from "../lib/gameEngine.ts";

/** The half of socket.io-client `Seat` listens on. */
function fakeSocket() {
  const handlers = new Map<string, (payload: unknown) => void>();
  const sent: { event: string; payload: any }[] = [];
  return {
    on(event: string, cb: (payload: unknown) => void) {
      handlers.set(event, cb);
    },
    emit(event: string, payload?: unknown) {
      sent.push({ event, payload });
    },
    refuse(event: string, code: string, message = "no") {
      handlers.get(event)!({ code, message });
    },
    sent,
    connected: false,
    close() {},
  };
}

function seatWith(refusals: [event: string, code: string][]) {
  const socket = fakeSocket();
  const seat = new Seat(socket as never, "tester", "u1", "cookie=1");
  for (const [event, code] of refusals) socket.refuse(event, code);
  return seat;
}

describe("a soak run names what refused it", () => {
  test("a refusal is counted under the event and the code it arrived with", () => {
    const seat = seatWith([
      ["game:error", "RATE_LIMITED"],
      ["game:error", "RATE_LIMITED"],
      ["game:rejoin_failed", "UNAUTHORIZED"],
    ]);
    assert.deepEqual(Object.fromEntries(seat.refusals), {
      "game:error RATE_LIMITED": 2,
      "game:rejoin_failed UNAUTHORIZED": 1,
    });
  });

  test("every event the harness listens on is counted", () => {
    for (const event of REFUSAL_EVENTS) {
      const seat = seatWith([[event, "SOME_CODE"]]);
      assert.equal(
        seat.refusals.get(`${event} SOME_CODE`),
        1,
        `${event} arrived and the run would not have said so`
      );
    }
  });

  test("a refusal with no code is still counted rather than dropped", () => {
    const seat = seatWith([["game:error", undefined as never]]);
    assert.equal([...seat.refusals.values()].reduce((a, b) => a + b, 0), 1);
  });

  test("the summary names the codes, not just how many there were", () => {
    const line = formatRefusals({
      "game:error RATE_LIMITED": 6,
      "game:rejoin_failed UNAUTHORIZED": 1,
    });
    assert.match(line, /7 refusals/, "the total is what a clean run is read for");
    assert.match(line, /RATE_LIMITED/);
    assert.match(line, /UNAUTHORIZED/);
    assert.match(line, /6/, "which refusal dominated is the first thing that narrows it");
  });

  test("a run nothing refused says so plainly", () => {
    assert.equal(formatRefusals({}), "0 refusals");
  });
});

// The refusals #603 set out to name turned out to be the harness's own. It
// offered the round winner any card but the one just received, while the rules
// offer a 3 through 10 (docs/RULES.md §10), so a winner holding an ace handed
// it over and the server answered INVALID_CARD. A soak that plays illegally
// spends its run proving the server rejects it, and every refusal it
// manufactures is one more thing between a reader and a real one.
describe("the soak does not manufacture its own refusals", () => {
  const card = (id: string, rank: string): Card =>
    ({ id, rank, suit: id.split("_")[1] ?? "clubs" }) as Card;

  /** A table where this seat won the round and owes the loser a card. */
  function exchangeTurn(hand: Card[], cardFromLoser?: Card) {
    const socket = fakeSocket();
    const seat = new Seat(socket as never, "winner", "u1", "cookie=1");
    seat.state = {
      players: [{ name: "winner", hand, handCount: hand.length }],
      currentTurnIndex: 0,
      lastPlayedCombination: null,
      gameOver: false,
      firstPlayMade: true,
      exchangePhase: { active: true, winnerIdx: 0, cardFromLoser },
      viewerSeatIndex: 0,
    } as never;
    return { seat, socket };
  }

  test("it gives back a card the rules allow, never the ace in its hand", () => {
    const hand = [card("A_clubs", "A"), card("K_hearts", "K"), card("7_spades", "7")];
    for (let i = 0; i < 50; i++) {
      const { seat, socket } = exchangeTurn(hand);
      const action = seat.act(() => i / 50);
      assert.ok(action, "the winner owes a card and did nothing");
      const legal = getValidGivebackCards(hand).map((c) => c.id);
      assert.ok(
        legal.includes(socket.sent[0].payload.cardId),
        `offered ${socket.sent[0].payload.cardId}, which the server refuses — legal: ${legal}`
      );
    }
  });

  test("it never hands straight back the card it was just given", () => {
    const fromLoser = card("5_hearts", "5");
    const hand = [fromLoser, card("6_clubs", "6")];
    const { seat, socket } = exchangeTurn(hand, fromLoser);
    seat.act(() => 0);
    assert.equal(socket.sent[0].payload.cardId, "6_clubs");
  });

  test("a hand with nothing in 3-10 still gives something back", () => {
    // The engine's own fallback: an empty giveback list deadlocks the table
    // behind an overlay that cannot be dismissed.
    const hand = [card("A_clubs", "A"), card("K_hearts", "K")];
    const { seat, socket } = exchangeTurn(hand);
    assert.ok(seat.act(() => 0), "the winner owes a card and did nothing");
    assert.equal(socket.sent.length, 1);
    assert.ok(getValidGivebackCards(hand).some((c) => c.id === socket.sent[0].payload.cardId));
  });
});
