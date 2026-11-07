// tests/integration/redisDegraded.test.ts — losing Redis mid-game costs cross-instance traffic only.
//
// The table lives on one instance, so nothing it does needs another: with Redis stopped under it,
// it must keep taking moves to the end of the round, the process must stay up, and the outage must
// be logged once rather than per connection or per retry.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { connectSocket, waitFor, type TestSocket } from "../helpers/client.ts";
import { dropSchema, hasDatabase, scopedDatabaseUrl, skipMessage } from "../helpers/testServer.ts";
import { boot, type Instance } from "../helpers/instance.ts";
import { driveRound } from "../helpers/gameDriver.ts";
import { dropKeyspace } from "../helpers/redisKeys.ts";
import { startProxy, targetOf, viaProxy, type Proxy } from "../helpers/tcpProxy.ts";

describe("Redis stopped mid-game", { skip: hasDatabase() ? false : skipMessage() }, () => {
  const schema = `rdg_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const baseUrl = process.env.DATABASE_URL!;
  const scoped = scopedDatabaseUrl(baseUrl, schema);
  const output: string[] = [];
  let proxy: Proxy;
  let instance: Instance;
  let port: number;
  let socket: TestSocket | undefined;

  before(async () => {
    // Creates the schema the child-process server is then pointed at.
    const admin = new pg.Pool({ connectionString: baseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.end();
    proxy = await startProxy(targetOf(process.env.REDIS_URL!, 6379));
    instance = await boot(scoped, {
      REDIS_URL: viaProxy(process.env.REDIS_URL!, proxy),
      LOG_LEVEL: "error",
      MURLAN_AFK_TIMEOUT_MS: "600000",
    });
    port = instance.port;
    instance.child.stdout?.on("data", (buf) => output.push(String(buf)));
  });

  after(async () => {
    socket?.close();
    instance?.child.kill("SIGKILL");
    await proxy?.close();
    await dropKeyspace(scoped);
    await dropSchema(baseUrl, schema);
  });

  test("a one-instance table keeps taking moves to the end of the round", { timeout: 90_000 }, async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: `rdg${Date.now().toString(36)}`, password: "degraded-pw", email: `rdg${Date.now()}@example.test` }),
    });
    assert.equal(res.status, 202, await res.text());
    const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    const host = await connectSocket(`http://127.0.0.1:${port}`, { cookie });
    socket = host;
    const created = waitFor(host, "room:state");
    host.emit("room:create", { gameMode: "free_for_all", maxPlayers: 4 });
    await created;

    let statesSinceStop = 0;
    let stopped = false;
    host.on("game:state", () => {
      if (stopped) statesSinceStop += 1;
      else {
        stopped = true;
        proxy.refuse(true);
      }
    });
    const result = await driveRound([host], () => host.emit("room:start", { fillWithBots: true }), {
      onExchange: "giveback",
      ms: 60_000,
    });

    assert.equal(result.stoppedOn, "roundOver");
    assert.ok(statesSinceStop >= 3, `only ${statesSinceStop} states after Redis stopped`);
    assert.equal(instance.child.exitCode, null, "the instance exited without Redis");
    const lines = output.join("").split("\n");
    assert.deepEqual(lines.filter((l) => l.includes("Unhandled")), [], "a Redis rejection went unhandled");
    const lost = lines.filter((l) => l.includes("Redis unreachable"));
    assert.equal(lost.length, 1, `the outage was logged ${lost.length} times:\n${output.join("").slice(-3000)}`);
  });
});
