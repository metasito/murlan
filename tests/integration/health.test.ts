// tests/integration/health.test.ts — readiness is this instance's to decide: a full app pool, a lost
// Postgres or a lost Redis is reported in the body and never fails the probe; a blocked event loop
// and a drain do.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import type { PoolClient } from "pg";
import { performance } from "node:perf_hooks";
import { eventually } from "../helpers/client.ts";
import { dropSchema, hasDatabase, scopedDatabaseUrl, skipMessage, startTestServer, type TestServer } from "../helpers/testServer.ts";
import { boot, freePorts, type Instance } from "../helpers/instance.ts";
import { dropKeyspace } from "../helpers/redisKeys.ts";
import { startProxy, targetOf, viaProxy, type Proxy } from "../helpers/tcpProxy.ts";
import { pool } from "../../server/store/db.ts";
import { beginShutdown } from "../../server/game/gameRoom.ts";
import { sendToInstance } from "../../server/store/instanceInbox.ts";
import { instanceId } from "../../server/store/redis.ts";

// The deployed size, which is what P7 saturated; read when `before` builds the app.
process.env.MURLAN_PG_POOL_MAX = "10";
const TOKEN = "metrics-token-for-tests";
process.env.METRICS_TOKEN = TOKEN;

const PROBE_BUDGET_MS = 200;
const DEPENDENCY_DOWN_BUDGET_MS = 1_500;

async function timed(url: string, init?: RequestInit) {
  const started = performance.now();
  const res = await fetch(url, init);
  const text = await res.text();
  return { status: res.status, text, ms: performance.now() - started };
}

const json = (text: string) => JSON.parse(text) as Record<string, unknown>;

describe("the probes on one instance", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    if (server) await server.stop();
  });

  test("with every app-pool client held, each probe answers 200 at once and reports both links", async () => {
    await eventually(async () => {
      const body = json((await timed(`${server.url}/health/ready`)).text);
      return body.db === "connected" && body.redis === "connected";
    }, "the first background probe to see both links");
    const held: PoolClient[] = await Promise.all(Array.from({ length: 10 }, () => pool().connect()));
    try {
      assert.equal(pool().idleCount, 0);
      for (const path of ["/health", "/health/ready", "/health/live"]) {
        const r = await timed(`${server.url}${path}`);
        assert.equal(r.status, 200, `${path} after ${Math.round(r.ms)} ms: ${r.text}`);
        assert.ok(r.ms < PROBE_BUDGET_MS, `${path} took ${Math.round(r.ms)} ms with the app pool full`);
        if (path !== "/health/live") assert.deepEqual([json(r.text).db, json(r.text).redis], ["connected", "connected"], r.text);
      }
    } finally {
      for (const client of held) client.release();
    }
  });

  test("a loop blocked for 300 ms over and over is not ready, and is again once free", { timeout: 30_000 }, async () => {
    const blocker = setInterval(() => {
      const end = performance.now() + 300;
      while (performance.now() < end);
    }, 100);
    try {
      const refused = await eventually(async () => {
        const r = await timed(`${server.url}/health/ready`);
        return r.status === 503 ? r : null;
      }, "readiness to refuse a blocked loop");
      assert.equal(json(refused.text).reason, "event_loop_lag", refused.text);
      assert.equal((await timed(`${server.url}/health/live`)).status, 200);
    } finally {
      clearInterval(blocker);
    }
    await eventually(async () => (await timed(`${server.url}/health/ready`)).status === 200, "readiness once the loop is free", 15_000);
  });

  test("/metrics answers only the bearer token, with no body otherwise", async () => {
    for (const authorization of [undefined, "Bearer wrong", `Bearer ${TOKEN}x`, TOKEN, `Basic ${TOKEN}`]) {
      const r = await timed(`${server.url}/metrics`, { headers: authorization ? { authorization } : {} });
      assert.deepEqual([r.status, r.text], [401, ""], `authorization ${authorization}`);
    }
    const r = await timed(`${server.url}/metrics`, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(r.status, 200, r.text);
  });

  test("/metrics lists the loop, every open pool, Redis and the connection headroom", async () => {
    server.io.emit("health:metrics-probe");
    await sendToInstance(instanceId, { kind: "health:metrics-probe" });
    const body = await eventually(async () => {
      const r = await timed(`${server.url}/metrics`, { headers: { authorization: `Bearer ${TOKEN}` } });
      const read = ["adapter", "inbox"].every((s) => new RegExp(`^redis_stream_lag_seconds\\{stream="${s}"\\} [\\d.e-]+$`, "m").test(r.text));
      return read ? r.text : null;
    }, "a broadcast and an addressed message read off their streams");
    for (const name of [
      "event_loop_lag_p99_seconds",
      "pg_pool_total",
      "pg_pool_idle",
      "pg_pool_waiting",
      "pg_connection_headroom",
      "redis_reconnects_total",
      "redis_stream_lag_seconds",
    ]) {
      assert.match(body, new RegExp(`^# TYPE ${name} (gauge|counter)$`, "m"), name);
    }
    for (const pool of ["murlan-app", "murlan-health"]) {
      assert.match(body, new RegExp(`^pg_pool_total\\{pool="${pool}"\\} \\d+$`, "m"), pool);
    }
    assert.match(body, /^pg_connection_headroom -?\d+$/m, "the boot check's headroom");
  });

  test("/metrics serves the store's own INFO, and the store is the one deploy/runtime.json names", async () => {
    const body = await eventually(async () => {
      const r = await timed(`${server.url}/metrics`, { headers: { authorization: `Bearer ${TOKEN}` } });
      return /^store_used_memory_bytes \d+$/m.test(r.text) ? r.text : null;
    }, "the store's first INFO");
    for (const name of ["store_maxmemory_bytes", "store_evicted_keys", "store_blocked_clients", "store_rejected_connections"]) {
      assert.match(body, new RegExp(`^${name} \\d+$`, "m"), name);
    }
    assert.match(body, /^store_info\{engine="valkey",version="9\.[\d.]+",maxmemory_policy="noeviction"\} 1$/m);
    assert.doesNotMatch(body, /^store_misconfigured_total\{[^}]*\} [1-9]/m, "the boot check found the store unlike the manifest's");
  });

  // Last: a drain cannot be undone inside a process.
  test("draining, the instance is live and not ready", async () => {
    beginShutdown();
    const ready = await timed(`${server.url}/health/ready`);
    assert.equal(ready.status, 503);
    assert.equal(json(ready.text).reason, "draining");
    assert.equal((await timed(`${server.url}/health`)).status, 503);
    assert.equal((await timed(`${server.url}/health/live`)).status, 200);
  });
});

describe("the probes with a dependency gone", { skip: hasDatabase() ? false : skipMessage() }, () => {
  const schema = `hlt_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const baseUrl = process.env.DATABASE_URL!;
  const scoped = scopedDatabaseUrl(baseUrl, schema);
  let pgProxy: Proxy;
  let redisProxy: Proxy;
  let instance: Instance;
  let url: string;

  before(async () => {
    // Creates the schema the child-process server is then pointed at.
    const admin = new pg.Pool({ connectionString: baseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.end();
    pgProxy = await startProxy(targetOf(baseUrl, 5432));
    redisProxy = await startProxy(targetOf(process.env.REDIS_URL!, 6379));
    const [port] = await freePorts(1);
    url = `http://127.0.0.1:${port}`;
    instance = await boot(port, viaProxy(scoped, pgProxy), { REDIS_URL: viaProxy(process.env.REDIS_URL!, redisProxy) });
  });

  after(async () => {
    instance?.child.kill("SIGKILL");
    await redisProxy?.close();
    await pgProxy?.close();
    await dropKeyspace(scoped);
    await dropSchema(baseUrl, schema);
  });

  test("a blackholed Redis, then a blackholed Postgres, leave it ready and named down", { timeout: 30_000 }, async () => {
    await eventually(async () => {
      const r = await timed(`${url}/health/ready`);
      return r.status === 200 && json(r.text).redis === "connected" && json(r.text).db === "connected";
    }, "both links up after boot");

    /** Every answer is immediate, and is 200, however long the dependency has been hanging. */
    const reports = async (path: string, links: [string, string]) => {
      const r = await timed(`${url}${path}`);
      assert.equal(r.status, 200, `${path}: ${r.text}`);
      assert.ok(r.ms < PROBE_BUDGET_MS, `${path} answered in ${Math.round(r.ms)} ms with a dependency hung`);
      return json(r.text).db === links[0] && json(r.text).redis === links[1];
    };

    redisProxy.blackholeExisting();
    redisProxy.blackholeNew(true);
    await eventually(() => reports("/health/ready", ["connected", "down"]), "Redis named down", DEPENDENCY_DOWN_BUDGET_MS * 2);

    pgProxy.blackholeExisting();
    pgProxy.blackholeNew(true);
    await eventually(() => reports("/health/ready", ["down", "down"]), "Postgres named down too", DEPENDENCY_DOWN_BUDGET_MS * 2);
    assert.ok(await reports("/health", ["down", "down"]));

    const metrics = await timed(`${url}/metrics`, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(metrics.status, 200, "/metrics waited on a dependency");
    assert.ok(metrics.ms < PROBE_BUDGET_MS, `/metrics took ${Math.round(metrics.ms)} ms`);
    await eventually(async () => {
      const r = await timed(`${url}/metrics`, { headers: { authorization: `Bearer ${TOKEN}` } });
      return /^redis_reconnects_total\{use="health"\} [1-9]/m.test(r.text);
    }, "the half-open Redis link to be counted reconnecting", 15_000);
  });
});
