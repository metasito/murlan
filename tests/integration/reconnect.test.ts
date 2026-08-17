import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { io as ioClient, type Socket } from "socket.io-client";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { connectAs, waitFor } from "../helpers/client.ts";
import { setUpRoom, startGame, type Client } from "../helpers/table.ts";

/**
 * The reconnect paths: what the table is told when a dropped player comes
 * back, and what the turn scheduler does about it.
 *
 * `server/socket.ts` reads these once at module scope, so they must be set
 * before that module is first imported — this file always runs as its own
 * process under `node --test`, so the override never leaks into another test
 * file's process. The grace window has to outlast a real HTTP round-trip for
 * the ticket plus a websocket handshake, since a returning player is a whole
 * new socket here.
 */
process.env.MURLAN_AFK_TIMEOUT_MS = "400";
process.env.MURLAN_DISCONNECT_GRACE_MS = "4000";
process.env.MURLAN_BOT_MOVE_DELAY_MS = "20";

interface AuthedClient extends Client {
  cookie: string;
}

interface ReconnectNotice {
  userId: string;
  username: string;
  code?: string;
  message?: string;
  params?: { username?: string };
}

describe("reconnect", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    await server.stop();
  });

  /**
   * A second socket for an account that already registered — the returning
   * half of a drop. `connectAs` would register a new user, and the register
   * route is rate limited per process, so the cookie is reused for a fresh
   * ticket instead.
   */
  async function reconnect(client: AuthedClient): Promise<Socket> {
    const res = await fetch(`${server.url}/api/auth/socket-ticket`, {
      method: "POST",
      headers: { cookie: client.cookie },
    });
    const text = await res.text();
    assert.equal(res.status, 200, text);
    const { ticket } = JSON.parse(text) as { ticket: string };

    const socket = ioClient(server.url, {
      auth: { ticket },
      transports: ["websocket"],
      reconnection: false,
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", (e) => reject(e));
    });
    return socket;
  }

  /**
   * Empties the table before its sockets go. A socket that simply closes on a
   * live game arms a disconnect grace timer, and this suite's grace outlasts
   * the whole file — the timer would then fire against a stopped server.
   */
  async function closeTable(clients: { socket: Socket }[]) {
    for (const client of clients) {
      if (client.socket.connected) client.socket.emit("room:leave");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    for (const client of clients) client.socket.close();
  }

  // ── Test 1 ──────────────────────────────────────────────────────────────

  /**
   * The connection handler's grace-timer block used to emit its own bare
   * `{ userId, username }`, which the client runs through
   * `translateServerPayload`: with no `code` and no `message` that resolves to
   * "an unexpected error occurred" and the whole table is shown an error
   * banner on the most ordinary reconnect there is. Both reconnect paths now
   * go through one emitter, so the payload is asserted on the path that had
   * the wrong one — and then again after an explicit `game:rejoin`, which is
   * what the app itself emits on connect.
   */
  test("a reconnect inside the grace window is announced as PLAYER_RECONNECTED", async () => {
    const alice = await connectAs(server, "recon_notice_alice");
    const bob = await connectAs(server, "recon_notice_bob");
    const room = await setUpRoom([alice, bob], 2);
    await startGame([alice, bob]);

    const table = [alice, bob];
    const notices: ReconnectNotice[] = [];
    alice.socket.on("game:player_reconnected", (p: ReconnectNotice) =>
      notices.push(p)
    );

    const dropped = waitFor(alice.socket, "game:player_disconnected", 5_000);
    bob.socket.disconnect();
    await dropped;

    const announced = waitFor<ReconnectNotice>(
      alice.socket,
      "game:player_reconnected",
      5_000
    );
    // No game:rejoin: this is the connection handler's own grace-timer path,
    // reached by the socket coming back and nothing else.
    const back = await reconnect(bob);
    table[1] = { ...bob, socket: back };
    try {
      const notice = await announced;
      assert.equal(notice.userId, bob.user.id);
      assert.equal(notice.code, "PLAYER_RECONNECTED");
      assert.equal(notice.params?.username, bob.user.username);
      assert.ok(notice.message, "the payload must carry a fallback message");

      // The other path, from the same socket: the app fires game:rejoin from
      // its own connect handler.
      const rejoined = waitFor(alice.socket, "game:player_reconnected", 5_000);
      back.emit("game:rejoin", { roomCode: room.roomId });
      await rejoined;

      assert.ok(notices.length >= 2, "both reconnect paths must announce the return");
      for (const seen of notices) {
        assert.equal(
          seen.code,
          "PLAYER_RECONNECTED",
          `every reconnect notice must be renderable: ${JSON.stringify(seen)}`
        );
      }
    } finally {
      await closeTable(table);
    }
  });
});
