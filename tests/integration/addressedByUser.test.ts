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
import { connectAs, reconnectWith, waitFor, waitForWhere, type TestSocket } from "../helpers/client.ts";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";


describe("a message for a person", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  const sockets: TestSocket[] = [];
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
    const socket = await reconnectWith(server, cookie);
    sockets.push(socket);
    return socket;
  }

  async function lobby(tag: string) {
    const host = await player(`${tag}_host`);
    const guest = await player(`${tag}_guest`);
    const made = waitFor(host.socket, "room:state");
    host.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
    const room = await made;
    const seated = waitFor(host.socket, "room:state");
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

    const dealt = waitFor(replacement, "game:state", 8_000);
    host.socket.emit("room:start", { fillWithBots: true });
    const state = await dealt;

    assert.ok(
      state.players.some((p) => p.name === guest.user.username),
      "the account was dealt into the round"
    );
    assert.ok((state.viewerSeatIndex ?? -1) >= 0, "and was shown it, on the socket it is holding");
  });

  /**
   * The room screen leaves for the table when it has game state, and it learns
   * a room started from `room:state`. Both arriving as one per-user message
   * means a single miss strands the player: no cards, and no record that the
   * room went in-progress, so nothing to rejoin with either.
   */
  test("the room is told it started, so no player depends on their own copy of the round", async () => {
    const { host, guest } = await lobby("started");

    // Not merely the next `room:state`: the guest's copy of the join broadcast
    // is delivered after the host's, so it can still be in flight here.
    const roomTold = waitForWhere(guest.socket, "room:state", (room) => room.status === "in_progress", 8_000).catch(
      () => null
    );
    host.socket.emit("room:start", { fillWithBots: true });

    assert.ok(
      await roomTold,
      "a client that missed its own game:state must still learn the room is playing"
    );
  });
});
