import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { io as ioClient } from "socket.io-client";
import { PROTOCOL_AUTH, ackUnchecked, register, socketTicket, waitFor, type TestSocket } from "../helpers/client.ts";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { friendStore } from "../../server/store/friendStore.ts";

describe("gameplay integrity: the connection handler registers every handler group", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    await server.stop();
  });

  // ── Test 0 ──────────────────────────────────────────────────────────────

  /**
   * Regression test for a startup race in the connection handler: it used
   * to `await friendStore.getFriends(userId)` (a real DB round-trip) before
   * registering any of the room:* / game:* listeners. An event emitted the
   * instant the client sees "connect" could land in that window and be
   * silently dropped — no error, no ack, nothing. This is exactly how the
   * app's own reconnect path behaves (OnlineGameContext fires game:rejoin
   * from its own "connect" handler), so a slow DB round-trip on a real
   * reconnect could strand a player with no way back into their game.
   *
   * This test builds its socket by hand rather than calling connectAs(), so
   * that no helper can paper over a regression by waiting for some later
   * server-sent event before handing the socket back.
   */
  test("an event emitted on the client's own connect handler is not dropped", async () => {
    const { user, cookie } = await register(server, "connect_race_user");
    const ticket = await socketTicket(server, cookie);

    // The handler's first await is this read. Held until the reply arrives, an
    // await moved above the registrations fails every run, not only on a slow database.
    const realGetFriends = friendStore.getFriends;
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let gated = false;
    friendStore.getFriends = async function (userId: string) {
      if (userId === user.id && !gated) {
        gated = true;
        await gate;
      }
      return realGetFriends.call(this, userId);
    };

    const probes: Record<string, [event: string, ...args: unknown[]]> = {
      registerRoomHandlers: ["room:create", { gameMode: "free_for_all", maxPlayers: 2 }],
      registerGameplayHandlers: ["game:rejoin", { roomId: "no-such-room" }],
      registerFriendHandlers: ["friend:get_online_list"],
    };
    const socketSource = readFileSync(new URL("../../server/socket/socket.ts", import.meta.url), "utf8");
    const groups = [...socketSource.matchAll(/\b(register\w+Handlers)\(ctx\)/g)].map((m) => m[1]);
    assert.deepEqual(groups.toSorted(), Object.keys(probes).toSorted(), "each handler group needs a probe");

    const socket: TestSocket = ioClient(server.url, {
      auth: { ...PROTOCOL_AUTH, ticket },
      transports: ["websocket"],
      reconnection: false,
    });
    try {
      const response = waitFor(socket, "room:state", 3_000);
      // Fired synchronously from within the "connect" handler itself —
      // no waiting for any other server event first, matching how
      // OnlineGameContext's attemptRejoin() fires game:rejoin on reconnect.
      const answers = new Promise<Record<string, unknown>[]>((resolve, reject) => {
        socket.once("connect", () => {
          Promise.all(
            groups.map((group) => {
              const [event, ...args] = probes[group]!;
              return ackUnchecked(socket, event, args, 3_000) as Promise<Record<string, unknown>>;
            })
          ).then(resolve, reject);
        });
      });
      const state = await response;
      assert.ok(state.roomId, "room:create emitted on connect must still get a reply");
      assert.equal(state.hostUserId, user.id);
      // answerUnknownEvents answers an event nothing was listening for yet as CLIENT_OUTDATED.
      const unheard = (await answers).flatMap((a, i) => (a.code === "CLIENT_OUTDATED" ? [groups[i]] : []));
      assert.deepEqual(unheard, [], "registered after the connection handler's first await");
    } finally {
      release();
      friendStore.getFriends = realGetFriends;
      socket.close();
    }
  });
});
