import { test } from "node:test";
import assert from "node:assert/strict";
import { hasDatabase, skipMessage, startTestServer } from "../helpers/testServer.ts";
import { connectAs, nothingArrives, waitFor, waitForWhere } from "../helpers/client.ts";
import { befriend } from "../helpers/friends.ts";
import { beginShutdown } from "../../server/game/gameRoom.ts";
import { inFlightCount } from "../../server/shared/inFlight.ts";

test("outside a drain the same departure is announced", { skip: hasDatabase() ? false : skipMessage(), timeout: 60_000 }, async () => {
  const server = await startTestServer();
  try {
    const leaving = await connectAs(server, `dp_c${Date.now() % 1e6}`);
    const watching = await connectAs(server, `dp_d${Date.now() % 1e6}`);
    await befriend(server, leaving, watching);
    const list = waitFor(watching.socket, "friend:online_list");
    watching.socket.emit("friend:get_online_list", {});
    await list;
    const offline = waitForWhere(watching.socket, "friend:status", (s) => s.userId === leaving.user.id && !s.online, 10_000);
    leaving.socket.close();
    await offline;
    watching.socket.close();
  } finally {
    await server.stop();
  }
});

/** Last: nothing resets `beginShutdown`, so a test after it runs in a draining process. */
/**
 * A drain moves every socket to another instance within DRAINING_SPREAD_MS. Telling their friends
 * they left would flicker each of them offline and back; the departure that is not a move is
 * announced as before.
 */
test("a socket the drain closes is not announced offline to its friends", { skip: hasDatabase() ? false : skipMessage(), timeout: 60_000 }, async () => {
  const server = await startTestServer();
  try {
    const leaving = await connectAs(server, `dp_a${Date.now() % 1e6}`);
    const watching = await connectAs(server, `dp_b${Date.now() % 1e6}`);
    await befriend(server, leaving, watching);
    const list = waitFor(watching.socket, "friend:online_list");
    watching.socket.emit("friend:get_online_list", {});
    await list;

    const quiet = nothingArrives(watching.socket, "friend:status", {
      ms: 900,
      matches: (s) => s.userId === leaving.user.id && !s.online,
      why: "a drained socket was announced offline",
    });
    beginShutdown();
    leaving.socket.close();
    await quiet;
    watching.socket.close();
  } finally {
    await server.stop();
  }
  assert.equal(inFlightCount(), 0);
});
