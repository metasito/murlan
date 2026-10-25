// Plays a real online table through a round on its clients' behalf, for the integration suites that
// need a round finished (or an exchange reached) rather than played move by move.
import assert from "node:assert/strict";
import { getValidGivebackCards, type Move } from "../../lib/game/gameEngine.ts";
import type { RoundOverPayload, WireGameState } from "../../shared/protocol.ts";
import { DEADLINE_SCALE, sendMove, type TestSocket } from "./client.ts";

export type DriveResult =
  | { stoppedOn: "roundOver"; payload: RoundOverPayload }
  | { stoppedOn: "exchange"; states: WireGameState[] };

/**
 * What the driver does when an exchange opens. `stop` resolves once every socket is shown it;
 * `giveback` answers it at once for the winner; `wait` idles and leaves it to the server's own
 * AFK/bot forced move.
 */
export type OnExchange = "stop" | "giveback" | "wait";

/**
 * Forced-minimum play: whoever leads plays the largest same-rank group anchored on their lowest card
 * (or the opening card), everyone else passes. It sheds several cards a play, which keeps a socket
 * under the action rate limit across repeated rounds.
 */
function forcedMinimum(state: WireGameState, seat: number, onExchange: OnExchange): Move | null {
  const hand = state.players[seat]?.hand ?? [];
  const exchange = state.exchangePhase;
  if (exchange?.kind === "open") {
    if (onExchange !== "giveback" || exchange.winnerIdx !== seat) return null;
    const [card] = getValidGivebackCards(hand, exchange.cardFromLoser.id);
    return card ? { kind: "giveback", cardId: card.id } : null;
  }
  if (state.currentTurnIndex !== seat || hand.length === 0) return null;
  if (state.lastPlayedCombination !== null) return { kind: "pass" };
  const opening = state.openingCard;
  const anchor = (opening && hand.find((c) => c.id === opening.id)) || hand[0]!;
  return { kind: "play", cardIds: hand.filter((c) => c.rank === anchor.rank).map((c) => c.id) };
}

/**
 * Drives every given socket's seat through the round. Listeners attach before `kickoff()`, so the
 * first state — which decides who opens — is never missed. Resolves once every socket still connected
 * has been sent `game:round_over` (or, under `stop`, the open exchange), so no closing broadcast is
 * left in flight to be read as the next round starting.
 *
 * Seats nobody drives are the server's: a bot's turn is paced by the turn arbiter, which is what
 * `ms` is budgeted against.
 */
export function driveRound(
  seats: (TestSocket | { socket: TestSocket })[],
  kickoff: () => void,
  opts: { onExchange?: OnExchange; ms?: number } = {}
): Promise<DriveResult> {
  const sockets = seats.map((s) => ("socket" in s ? s.socket : s));
  const onExchange = opts.onExchange ?? "stop";
  return new Promise((resolve, reject) => {
    let done = false;
    const live = new Set(sockets);
    const over = new Map<TestSocket, RoundOverPayload>();
    const atExchange = new Map<TestSocket, WireGameState>();
    const detach: (() => void)[] = [];

    const timer = setTimeout(
      () => finish(new Error("timed out driving a round toward its end or an exchange")),
      (opts.ms ?? 15_000) * DEADLINE_SCALE
    );

    function finish(result: DriveResult | Error) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const off of detach) off();
      if (result instanceof Error) reject(result);
      else resolve(result);
    }

    function check() {
      const waiting = [...live];
      if (waiting.length === 0) return;
      if (waiting.every((s) => over.has(s))) {
        finish({ stoppedOn: "roundOver", payload: over.get(waiting[0]!)! });
      } else if (onExchange === "stop" && waiting.every((s) => atExchange.has(s))) {
        finish({ stoppedOn: "exchange", states: waiting.map((s) => atExchange.get(s)!) });
      }
    }

    for (const socket of sockets) {
      const onOver = (payload: RoundOverPayload) => {
        over.set(socket, payload);
        check();
      };
      const onGone = () => {
        live.delete(socket);
        check();
      };
      const onState = (state: WireGameState) => {
        if (done || state.roundOver) return;
        if (onExchange === "stop" && state.exchangePhase?.kind === "open") {
          atExchange.set(socket, state);
          check();
          return;
        }
        const seat = state.viewerSeatIndex;
        if (seat === null) return;
        const move = forcedMinimum(state, seat, onExchange);
        if (move) void sendMove(socket, move);
      };
      socket.on("game:round_over", onOver);
      socket.on("game:state", onState);
      socket.on("disconnect", onGone);
      detach.push(() => {
        socket.off("game:round_over", onOver);
        socket.off("game:state", onState);
        socket.off("disconnect", onGone);
      });
    }

    kickoff();
  });
}

/** The `game:round_over` payload of a round a suite drove to completion. */
export function roundOverOf(result: DriveResult): RoundOverPayload {
  assert.ok(result.stoppedOn === "roundOver", `the round had to run to game:over, stopped on ${result.stoppedOn}`);
  return result.payload;
}

/**
 * Plays the round to `game:round_over`, answering any exchange at once. For suites that need a
 * round finished — what the game-over path writes — rather than the round itself; a table with bot
 * seats needs every bot turn's pace, hence the longer default.
 */
export async function playRoundOut(
  seats: (TestSocket | { socket: TestSocket })[],
  kickoff: () => void,
  ms = 60_000
): Promise<RoundOverPayload> {
  return roundOverOf(await driveRound(seats, kickoff, { onExchange: "giveback", ms }));
}
