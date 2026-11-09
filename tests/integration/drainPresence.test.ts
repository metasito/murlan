import { test } from "node:test";
import assert from "node:assert/strict";
import { hasDatabase, skipMessage, startTestServer } from "../helpers/testServer.ts";
import { connectAs, waitFor, waitForWhere } from "../helpers/client.ts";
import { befriend } from "../helpers/friends.ts";
import { beginShutdown, isShuttingDown } from "../../server/game/gameRoom.ts";
import { inFlightCount } from "../../server/shared/inFlight.ts";

test("a socket the drain closes is announced offline, and stop() waits for the notice", { skip: hasDatabase() ? false : skipMessage(), timeout: 60_000 }, async () => {
  const server = await startTestServer();
  try {
    const leaving = await connectAs(server, `dp_a${Date.now() % 1e6}`);
    const watching = await connectAs(server, `dp_b${Date.now() % 1e6}`);
    await befriend(server, leaving, watching);
    const list = waitFor(watching.socket, "friend:online_list");
    watching.socket.emit("friend:get_online_list", {});
    await list;

    const offline = waitForWhere(watching.socket, "friend:status", (s) => s.userId === leaving.user.id && !s.online, 10_000);
    beginShutdown();
    leaving.socket.close();
    await offline;
    watching.socket.close();
  } finally {
    await server.stop();
  }
  assert.equal(inFlightCount(), 0);
  assert.equal(isShuttingDown(), false, "stop() ends the shutdown the test staged, so the next server in this process boots");
});

test("a server boots after a drained one in the same process", { skip: hasDatabase() ? false : skipMessage(), timeout: 60_000 }, async () => {
  const server = await startTestServer();
  await server.stop();
});
