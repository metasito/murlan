import assert from "node:assert/strict";
import type { Socket } from "socket.io-client";
import type { Card } from "../../lib/gameEngine.ts";
import { connectAs, waitFor, DEADLINE_SCALE, type RegisteredUser } from "./client.ts";
import type { TestServer } from "./testServer.ts";

/**
 * Shared machinery for the integration suites that seat a table and play a
 * hand: the wire shapes the server sanitises down to, room setup, and a driver
 * that plays forced-minimum moves on every client's behalf.
 *
 * Lives here rather than inside one suite because `/api/auth/register` is rate
 * limited to 20 per process, so a suite that outgrows that budget has to split
 * into a second file — and a copied driver is a driver that only gets fixed in
 * one of them.
 */

export interface SanitizedPlayer {
  id: string;
  name: string;
  hand: Card[];
  handCount: number;
  type: string;
  finishPosition?: number;
}

export interface ExchangePhase {
  active: boolean;
  winnerIdx: number;
  loserIdx: number;
  cardFromLoser: Card;
  bothJokersException: boolean;
}

export interface SanitizedState {
  players: SanitizedPlayer[];
  currentTurnIndex: number;
  lastPlayedCombination: unknown | null;
  lastPlayedBy: number;
  gameOver: boolean;
  firstPlayMade: boolean;
  startCard?: Card;
  exchangePhase?: ExchangePhase;
  viewerSeatIndex: number;
}

export interface RoomState {
  roomId: string;
  code: string;
  hostUserId: string | null;
  status: string;
  gameMode: string;
  maxPlayers: number;
  players: { seatIndex: number; userId: string; username: string }[];
}

export interface Client {
  socket: Socket;
  user: RegisteredUser;
}

export interface GameOverPayload {
  rankings: string[];
  matchOver: boolean;
}

export async function makeClients(
  server: TestServer,
  usernames: string[]
): Promise<Client[]> {
  const clients: Client[] = [];
  for (const name of usernames) {
    clients.push(await connectAs(server, name));
  }
  return clients;
}

/** clients[0] creates the room, everyone else joins in order. Returns the
 * room state after the last join. */
export async function setUpRoom(
  clients: Client[],
  maxPlayers: number,
  gameMode: "free_for_all" | "teams" = "free_for_all"
): Promise<RoomState> {
  const host = clients[0];
  const created = waitFor<RoomState>(host.socket, "room:state");
  host.socket.emit("room:create", { gameMode, maxPlayers });
  let state = await created;
  for (const guest of clients.slice(1)) {
    const joined = waitFor<RoomState>(guest.socket, "room:state");
    guest.socket.emit("room:join", { code: state.code });
    state = await joined;
  }
  return state;
}

/** Starts the game and returns each client's own opening game:state,
 * captured raw (no moves are made on their behalf). */
export async function startGame(clients: Client[]): Promise<SanitizedState[]> {
  const waits = clients.map((c) => waitFor<SanitizedState>(c.socket, "game:state"));
  clients[0].socket.emit("room:start");
  return Promise.all(waits);
}

export type DriveResult =
  | { stoppedOn: "gameOver"; payload: unknown }
  | { stoppedOn: "exchange"; states: Map<Client, SanitizedState> };

/**
 * Drives forced-minimum play for every idle client attached: whoever is
 * leading a new round plays the largest same-rank group anchored on their
 * lowest card (or the mandatory start card, for the very first play of the
 * game), everyone else always passes. This mirrors the server's own
 * AFK/bot forced-minimum path (see autoMoveForSeat in server/socket.ts),
 * but is triggered immediately by the test instead of waiting on a timer,
 * and sheds several cards per play to keep the per-socket event count
 * comfortably under the rate limiter across repeated hands.
 *
 * Listeners attach before `kickoff()`, so the first game:state — which decides
 * who plays the mandatory start card — is never missed. Resolves once
 * `game:over` or an active exchange has been seen from every client, so no
 * closing broadcast is left in flight to be read as the next hand starting.
 *
 * `stopOnExchange: false` plays straight through an exchange instead: the
 * driver simply idles while it is up, and the server's own AFK/bot forced
 * move resolves it, so the manche runs to `game:over`.
 */
export function driveHandToExchangeOrOver(
  clients: Client[],
  kickoff: () => void,
  opts: { stopOnExchange?: boolean } = {}
): Promise<DriveResult> {
  const stopOnExchange = opts.stopOnExchange ?? true;
  return new Promise((resolve, reject) => {
    let settled = false;
    const overPayloads = new Map<Client, unknown>();
    const exchangeStates = new Map<Client, SanitizedState>();
    const stateHandlers: [Client, (s: SanitizedState) => void][] = [];
    const overHandlers: [Client, (p: unknown) => void][] = [];

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("timed out driving a hand toward completion or an exchange phase"));
    }, 15_000 * DEADLINE_SCALE);

    function cleanup() {
      clearTimeout(timer);
      for (const [c, h] of stateHandlers) c.socket.off("game:state", h);
      for (const [c, h] of overHandlers) c.socket.off("game:over", h);
    }

    function finish(result: DriveResult) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    }

    for (const client of clients) {
      const onOver = (payload: unknown) => {
        overPayloads.set(client, payload);
        if (overPayloads.size === clients.length) {
          finish({ stoppedOn: "gameOver", payload });
        }
      };
      overHandlers.push([client, onOver]);
      client.socket.on("game:over", onOver);

      const onState = (state: SanitizedState) => {
        if (settled || state.gameOver) return;
        if (state.exchangePhase?.active) {
          if (!stopOnExchange) return;
          exchangeStates.set(client, state);
          if (exchangeStates.size === clients.length) {
            finish({ stoppedOn: "exchange", states: exchangeStates });
          }
          return;
        }
        const seat = state.viewerSeatIndex;
        if (state.currentTurnIndex !== seat) return;
        const hand = state.players[seat]?.hand ?? [];
        if (hand.length === 0) return;

        if (state.lastPlayedCombination !== null) {
          client.socket.emit("game:pass");
          return;
        }

        let anchor = hand[0];
        if (!state.firstPlayMade && state.startCard) {
          const forced = hand.find((c) => c.id === state.startCard!.id);
          if (forced) anchor = forced;
        }
        const group = hand.filter((c) => c.rank === anchor.rank).map((c) => c.id);
        client.socket.emit("game:play", { cardIds: group });
      };
      stateHandlers.push([client, onState]);
      client.socket.on("game:state", onState);
    }

    kickoff();
  });
}

/**
 * The next deal a client is sent — a `game:state` that is not the finished
 * state of the manche just played. `driveHandToExchangeOrOver` settles on the
 * *first* client's `game:over`, so the other clients' closing broadcasts can
 * still be in flight when a caller starts waiting for the next hand.
 */
export function waitForDeal(socket: Socket, ms = 8_000): Promise<SanitizedState> {
  return new Promise((resolve, reject) => {
    const onState = (state: SanitizedState) => {
      if (state.gameOver) return;
      clearTimeout(timer);
      socket.off("game:state", onState);
      resolve(state);
    };
    const timer = setTimeout(() => {
      socket.off("game:state", onState);
      reject(new Error("timed out waiting for the next deal"));
    }, ms * DEADLINE_SCALE);
    socket.on("game:state", onState);
  });
}

/** The `game:over` payload of a hand a suite drove to completion. */
export function gameOverOf(result: DriveResult): GameOverPayload {
  assert.ok(
    result.stoppedOn === "gameOver",
    `the manche had to run to game:over, stopped on ${result.stoppedOn}`
  );
  return result.payload as GameOverPayload;
}

/**
 * The viewer sees their own hand and nobody else's. Both halves are decided by
 * `playerMap`, so this is what fails first if a seat is renumbered under a
 * player — which is why every deal, opening or rematch, is checked with it
 * rather than only the first one.
 */
export function assertHandSecrecy(state: SanitizedState, where: string) {
  state.players.forEach((p, seat) => {
    if (seat === state.viewerSeatIndex) {
      assert.ok(p.hand.length > 0, `${where}: own seat must carry a real hand`);
      assert.equal(p.handCount, p.hand.length, `${where}: own handCount must match`);
    } else {
      assert.deepEqual(
        p.hand,
        [],
        `${where}: seat ${seat} must not leak cards to another viewer`
      );
      assert.ok(
        p.handCount > 0,
        `${where}: handCount must still be reported for other seats`
      );
    }
  });
}
