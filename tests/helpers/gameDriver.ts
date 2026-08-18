// Drives a real online table to game over, for integration suites that care
// about what the game-over path *writes* rather than about the game itself.
//
// Extracted from tests/integration/stats.test.ts once a second suite needed
// it: stats, history, replays and ratings are all written from the same
// `handleGameOver` block, so they all need the same "get a table to finish"
// machinery and none of them should own a private copy of it.
import type { Socket } from "socket.io-client";
import { getValidGivebackCards } from "../../lib/gameEngine.ts";
import type { Card } from "../../lib/gameEngine.ts";

export interface ExchangePhaseView {
  active: boolean;
  winnerIdx: number;
  loserIdx: number;
  cardFromLoser: Card;
  bothJokersException: boolean;
}

export interface SanitizedPlayer {
  id: string;
  name: string;
  hand: Card[];
  handCount: number;
  type: string;
}

export interface SanitizedState {
  players: SanitizedPlayer[];
  currentTurnIndex: number;
  lastPlayedCombination: unknown | null;
  gameOver: boolean;
  firstPlayMade: boolean;
  startCard?: Card;
  exchangePhase?: ExchangePhaseView;
  viewerSeatIndex: number;
}

export interface RoomState {
  roomId: string;
  code: string;
}

/**
 * Plays every given human seat to the end of the hand: the forced-minimum
 * grouped play on a new round, a pass otherwise, and an immediate valid
 * giveback the instant a seat is the exchange winner. Resolves with the
 * `game:over` payload.
 *
 * Real clients only — a bot-filled seat is left to the server's own turn
 * arbiter (armTurn/runBotTurn), which paces bot moves roughly 1.2s apart.
 * Driving the *human* seats immediately, rather than also waiting on their AFK
 * timers, keeps the wall-clock cost down to "however many bot turns the table
 * needs" instead of "every turn at the AFK pace".
 */
export function driveHumansToGameOver(
  clients: Socket[],
  kickoff: () => void,
  timeoutMs = 60_000
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const seats = new Map<Socket, number>();
    const handlers = new Map<Socket, (state: SanitizedState) => void>();

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("timed out driving the table to game:over"));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      for (const c of clients) {
        c.off("game:state", handlers.get(c)!);
        c.off("game:over", onOver);
      }
    }

    function onOver(payload: unknown) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(payload);
    }

    for (const client of clients) {
      const onState = (state: SanitizedState) => {
        if (settled || state.gameOver) return;
        if (!seats.has(client)) seats.set(client, state.viewerSeatIndex);
        const seat = seats.get(client)!;

        if (state.exchangePhase?.active) {
          if (state.exchangePhase.winnerIdx !== seat) return;
          const hand = state.players[seat]?.hand ?? [];
          const [card] = getValidGivebackCards(hand, state.exchangePhase.cardFromLoser?.id);
          if (card) client.emit("game:exchange_give_card", { cardId: card.id });
          return;
        }

        if (state.currentTurnIndex !== seat) return;
        const hand = state.players[seat]?.hand ?? [];
        if (hand.length === 0) return;

        if (state.lastPlayedCombination !== null) {
          client.emit("game:pass");
          return;
        }

        let anchor = hand[0];
        if (!state.firstPlayMade && state.startCard) {
          const forced = hand.find((c) => c.id === state.startCard!.id);
          if (forced) anchor = forced;
        }
        const group = hand.filter((c) => c.rank === anchor.rank).map((c) => c.id);
        client.emit("game:play", { cardIds: group });
      };
      handlers.set(client, onState);
      client.on("game:state", onState);
      client.on("game:over", onOver);
    }

    kickoff();
  });
}

/**
 * Polls until `check` returns something truthy, or gives up.
 *
 * Everything `handleGameOver` writes is deliberately fire-and-forget, so it
 * lands a beat after `game:over` itself — a straight read right after the
 * event is a race, not an assertion.
 */
export async function waitForRow<T>(
  check: () => Promise<T | null>,
  ms = 5_000
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const row = await check();
    if (row) return row;
    if (Date.now() > deadline) throw new Error("timed out waiting for a DB row to appear");
    await new Promise((r) => setTimeout(r, 100));
  }
}
