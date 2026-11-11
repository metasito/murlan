import { test } from "node:test";
import assert from "node:assert/strict";
import { hasDatabase, skipMessage, startTestServer, type TestServer } from "../helpers/testServer.ts";
import { connectAs, nothingArrives, reconnectWith, waitFor, waitForWhere } from "../helpers/client.ts";
import { at, boot, stopInstance } from "../helpers/instance.ts";
import { befriend } from "../helpers/friends.ts";
import { beginShutdown, isShuttingDown } from "../../server/game/gameRoom.ts";
import { inFlightCount } from "../../server/shared/inFlight.ts";

test("a socket closed while shutting down is announced offline, and stop() waits for the notice", { skip: hasDatabase() ? false : skipMessage(), timeout: 60_000 }, async () => {
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

test("a friend who comes back to a peer later than the offline debounce is never shown offline", { skip: hasDatabase() ? false : skipMessage(), timeout: 90_000 }, async () => {
  const peer = await startTestServer();
  const draining = await boot(process.env.DATABASE_URL!, { SESSION_SECRET: process.env.SESSION_SECRET! });
  try {
    const leaving = await connectAs({ url: at(draining.port) } as TestServer, `dl_a${Date.now() % 1e6}`);
    const watching = await connectAs(peer, `dl_b${Date.now() % 1e6}`);
    await befriend(peer, leaving, watching);
    const list = waitFor(watching.socket, "friend:online_list");
    watching.socket.emit("friend:get_online_list", {});
    assert.deepEqual((await list).onlineIds, [leaving.user.id]);

    const offline = (s: { userId: string; online: boolean }) => s.userId === leaving.user.id && !s.online;
    const shownOffline: unknown[] = [];
    watching.socket.on("friend:status", (s) => void (offline(s) && shownOffline.push(s)));
    leaving.socket.io.opts.reconnection = false;
    const told = waitFor(leaving.socket, "server:draining", 10_000);
    const closed = waitFor(leaving.socket, "disconnect", 10_000);
    draining.child.kill("SIGTERM");
    await told;
    await closed;
    await nothingArrives(watching.socket, "friend:status", { ms: 1_500, matches: offline, why: "shown offline while its reconnect waited out the drain" });

    const online = waitForWhere(watching.socket, "friend:status", (s) => s.userId === leaving.user.id && s.online, 10_000);
    const back = await reconnectWith(peer, leaving.cookie);
    await online;
    await nothingArrives(watching.socket, "friend:status", { matches: offline, why: "shown offline after it came back" });
    assert.deepEqual(shownOffline, []);
    back.close();
    watching.socket.close();
  } finally {
    await stopInstance(draining.child);
    await peer.stop();
  }
});

test("a server boots after a drained one in the same process", { skip: hasDatabase() ? false : skipMessage(), timeout: 60_000 }, async () => {
  const server = await startTestServer();
  await server.stop();
});
