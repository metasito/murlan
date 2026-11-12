import { test } from "node:test";
import assert from "node:assert/strict";
import { hasDatabase, skipMessage, startTestServer, type TestServer } from "../helpers/testServer.ts";
import { connectAs, nothingArrives, reconnectWith, waitFor, waitForWhere } from "../helpers/client.ts";
import { at, boot, stopInstance } from "../helpers/instance.ts";
import { befriend } from "../helpers/friends.ts";
import { beginShutdown, isShuttingDown } from "../../server/game/gameRoom.ts";
import { inFlightCount } from "../../server/shared/inFlight.ts";
import { HEARTBEAT_MS, LEAVING_MS } from "../../server/store/presence.ts";

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

test("a drained friend who comes back to a peer is never shown offline, and one who never comes back is, once the reconnect spread has passed", { skip: hasDatabase() ? false : skipMessage(), timeout: 90_000 }, async () => {
  const peer = await startTestServer();
  const draining = await boot(process.env.DATABASE_URL!, { SESSION_SECRET: process.env.SESSION_SECRET! });
  try {
    const there = { url: at(draining.port) } as TestServer;
    const returning = await connectAs(there, `dl_a${Date.now() % 1e6}`);
    const quitting = await connectAs(there, `dl_q${Date.now() % 1e6}`);
    const watching = await connectAs(peer, `dl_b${Date.now() % 1e6}`);
    await befriend(peer, returning, watching);
    await befriend(peer, quitting, watching);
    const list = waitFor(watching.socket, "friend:online_list");
    watching.socket.emit("friend:get_online_list", {});
    assert.deepEqual(new Set((await list).onlineIds), new Set([returning.user.id, quitting.user.id]));

    const offline = (s: { userId: string; online: boolean }) => !s.online && (s.userId === returning.user.id || s.userId === quitting.user.id);
    const shownOffline: { userId: string }[] = [];
    watching.socket.on("friend:status", (s) => void (offline(s) && shownOffline.push(s)));
    for (const { socket } of [returning, quitting]) socket.io.opts.reconnection = false;
    const told = waitFor(returning.socket, "server:draining", 10_000);
    const closed = Promise.all([waitFor(returning.socket, "disconnect", 10_000), waitFor(quitting.socket, "disconnect", 10_000)]);
    draining.child.kill("SIGTERM");
    await told;
    await closed;
    const closedAt = Date.now();
    await nothingArrives(watching.socket, "friend:status", { ms: 1_500, matches: offline, why: "shown offline while its reconnect waited out the drain" });

    const online = waitForWhere(watching.socket, "friend:status", (s) => s.userId === returning.user.id && s.online, 10_000);
    const back = await reconnectWith(peer, returning.cookie);
    await online;
    const located = waitFor(watching.socket, "friend:online_list");
    watching.socket.emit("friend:get_online_list", {});
    assert.ok((await located).onlineIds.includes(quitting.user.id), "read as offline inside the reconnect spread, while its friends were told online");

    const gone = await waitForWhere(watching.socket, "friend:status", (s) => s.userId === quitting.user.id && !s.online, LEAVING_MS + 3 * HEARTBEAT_MS);
    assert.ok(Date.parse(gone.lastSeen!) <= closedAt + 1_000, `last seen ${gone.lastSeen}, the sweep's time rather than the departure's`);
    await nothingArrives(watching.socket, "friend:status", { ms: HEARTBEAT_MS + 1_000, matches: offline, why: "shown offline after it came back" });
    assert.deepEqual(shownOffline.map((s) => s.userId), [quitting.user.id]);
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
