// tests/integration/localDelivery.test.ts — a table on one instance costs the cluster nothing.
//
// Every recipient of a round played on one instance has a socket on it, so nothing the round
// sends has anywhere to go but that process's own sockets.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { register } from "prom-client";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { connectAs, waitFor, type TestSocket } from "../helpers/client.ts";
import { playRoundOut } from "../helpers/gameDriver.ts";
import type { WireGameState } from "../../shared/protocol.ts";

async function clusterMessages(): Promise<number> {
  const metric = await register.getSingleMetric("cluster_messages_total")?.get();
  assert.ok(metric, "cluster_messages_total is not registered");
  return metric.values.reduce((sum, v) => sum + v.value, 0);
}

describe("a round on one instance", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  const sockets: TestSocket[] = [];

  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    for (const s of sockets) s.close();
    await server.stop();
  });

  test("puts no message on the cluster for any move", async () => {
    const tag = Date.now().toString(36);
    const a = await connectAs(server, `ld_a_${tag}`);
    const b = await connectAs(server, `ld_b_${tag}`);
    sockets.push(a.socket, b.socket);
    const created = waitFor(a.socket, "room:state");
    a.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
    const room = await created;
    const joined = waitFor(a.socket, "room:state");
    b.socket.emit("room:join", { code: room.code });
    await joined;

    let atDeal: Promise<number> | null = null;
    let moves = 0;
    a.socket.on("game:state", (state: WireGameState) => {
      atDeal ??= clusterMessages();
      if (state.lastMove.kind !== "deal") moves += 1;
    });
    await playRoundOut([a.socket, b.socket], () => a.socket.emit("room:start"), 45_000);

    assert.ok(atDeal, "the round was never dealt");
    assert.ok(moves > 0, "the round was over before anyone moved");
    const sent = (await clusterMessages()) - (await atDeal);
    assert.equal(sent, 0, `${moves} moves put ${sent} messages on the cluster`);
  });
});
