// tests/integration/addressedByUser.test.ts — a message for a person reaches the person.
//
// Every per-user send resolved through `userSocketMap`, a Map from userId to one
// socket id. A send whose lookup came back empty was skipped silently, and the
// caller could not tell that from delivered. The worst case is the deal: a player
// skipped there is left holding a seat in a hand they were never shown, looking
// idle to everyone else because they cannot act on cards they do not have.
//
// These tests address the account, not a socket, so the single-socket assumption
// is the thing under test rather than the thing assumed.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import type { Socket } from "socket.io-client";
import { io as ioClient } from "socket.io-client";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { connectAs, waitFor } from "../helpers/client.ts";
import type { SanitizedState } from "../helpers/table.ts";

interface RoomState {
  code: string;
  roomId: string;
  status: string;
  hostUserId: string | null;
  players: { userId: string; seatIndex: number }[];
}

describe("a message for a person", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  const sockets: Socket[] = [];
  let n = 0;

  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    for (const s of sockets) if (s.connected) s.close();
    await server.stop();
  });

  async function player(tag: string) {
    const c = await connectAs(server, `ab_${tag}_${Date.now().toString(36)}_${n++}`);
    sockets.push(c.socket);
    return c;
  }

  /** A second live socket for an account that already has one. */
  async function secondSocket(cookie: string) {
    const res = await fetch(`${server.url}/api/auth/socket-ticket`, {
      method: "POST",
      headers: { cookie },
    });
    const { ticket } = (await res.json()) as { ticket: string };
    const socket = ioClient(server.url, {
      auth: { ticket },
      transports: ["websocket"],
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", reject);
    });
    return socket;
  }

  async function lobby(tag: string) {
    const host = await player(`${tag}_host`);
    const guest = await player(`${tag}_guest`);
    const made = waitFor<RoomState>(host.socket, "room:state");
    host.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
    const room = await made;
    const seated = waitFor<RoomState>(host.socket, "room:state");
    guest.socket.emit("room:join", { code: room.code });
    assert.equal((await seated).players.length, 2);
    return { host, guest, room };
  }

  /**
   * The socket the account is *using* is the newest one, and `userSocketMap`
   * names exactly one. Anything addressed to the account has to arrive on the
   * socket that is actually live, whichever of them that is.
   */
  test("reaches the socket the account is actually using, not the one a map remembers", async () => {
    const { host, guest } = await lobby("evict");

    // The account reconnects. The server evicts the first socket and the second
    // is now the live one; a per-user send must follow the account, not a
    // remembered id.
    const replacement = await secondSocket(guest.cookie);

    const dealt = waitFor<SanitizedState>(replacement, "game:state", 8_000);
    host.socket.emit("room:start", { fillWithBots: true, botDifficulty: "easy" });
    const state = await dealt;

    assert.ok(
      state.players.some((p) => p.name === guest.user.username),
      "the account was dealt into the hand"
    );
    assert.ok(state.viewerSeatIndex >= 0, "and was shown it, on the socket it is holding");
  });

  /**
   * The room screen leaves for the table when it has game state, and it learns
   * a room started from `room:state`. Both arriving as one per-user message
   * means a single miss strands the player: no cards, and no record that the
   * room went in-progress, so nothing to rejoin with either.
   */
  test("the room is told it started, so no player depends on their own copy of the hand", async () => {
    const { host, guest } = await lobby("started");

    // Not merely the next `room:state`: the guest's copy of the join broadcast
    // is delivered after the host's, so it can still be in flight here.
    const roomTold = new Promise<RoomState | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 8_000);
      const onState = (payload: RoomState) => {
        if (payload.status !== "in_progress") return;
        clearTimeout(timer);
        guest.socket.off("room:state", onState);
        resolve(payload);
      };
      guest.socket.on("room:state", onState);
    });
    host.socket.emit("room:start", { fillWithBots: true, botDifficulty: "easy" });

    assert.ok(
      await roomTold,
      "a client that missed its own game:state must still learn the room is playing"
    );
  });
});
