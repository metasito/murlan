import assert from "node:assert/strict";
import { connectAs, waitFor, waitForWhere, type RegisteredUser, type TestSocket } from "./client.ts";
import type { TestServer } from "./testServer.ts";
import type { WireGameState, WireRoomState } from "../../shared/protocol.ts";

/**
 * Room setup for the integration suites that seat a table. Shared rather than per suite because
 * `/api/auth/register` is rate limited per process, so a suite that outgrows that budget splits into
 * a second file — and a copied helper only gets fixed in one of them.
 */

export interface Client {
  socket: TestSocket;
  user: RegisteredUser;
  /** What `reconnectWith` buys the next ticket with. */
  cookie: string;
}

export async function makeClients(server: TestServer, usernames: string[]): Promise<Client[]> {
  const clients: Client[] = [];
  for (const name of usernames) {
    clients.push(await connectAs(server, name));
  }
  return clients;
}

/** clients[0] creates the room, everyone else joins in order. Returns the room state after the last join. */
export async function setUpRoom(
  clients: Client[],
  maxPlayers: number,
  gameMode: "free_for_all" | "teams" = "free_for_all"
): Promise<WireRoomState> {
  const host = clients[0]!;
  const created = waitFor(host.socket, "room:state");
  host.socket.emit("room:create", { gameMode, maxPlayers });
  let state = await created;
  for (const guest of clients.slice(1)) {
    const joined = waitFor(guest.socket, "room:state");
    guest.socket.emit("room:join", { code: state.code });
    state = await joined;
  }
  return state;
}

/** Starts the game and returns each client's own opening state, captured raw (no moves are made). */
export async function startGame(clients: Client[]): Promise<WireGameState[]> {
  const waits = clients.map((c) => waitFor(c.socket, "game:state"));
  clients[0]!.socket.emit("room:start", {});
  return Promise.all(waits);
}

/**
 * The next round a client is sent — a state that is not the finished state of the round just
 * played, whose closing broadcasts can still be in flight when a caller starts waiting.
 */
export function waitForDeal(socket: TestSocket, ms = 8_000): Promise<WireGameState> {
  return waitForWhere(socket, "game:state", (state) => !state.roundOver, ms);
}

/**
 * The viewer sees their own hand and nobody else's. Both halves are decided by `playerMap`, so this
 * is what fails first if a seat is renumbered under a player — which is why every deal is checked.
 */
export function assertHandSecrecy(state: WireGameState, where: string) {
  state.players.forEach((p, seat) => {
    if (seat === state.viewerSeatIndex) {
      assert.ok(p.hand.length > 0, `${where}: own seat must carry a real hand`);
      assert.equal(p.handCount, p.hand.length, `${where}: own handCount must match`);
    } else {
      assert.deepEqual(p.hand, [], `${where}: seat ${seat} must not leak cards to another viewer`);
      assert.ok(p.handCount > 0, `${where}: handCount must still be reported for other seats`);
    }
  });
}
