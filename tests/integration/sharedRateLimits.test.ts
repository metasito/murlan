// tests/integration/sharedRateLimits.test.ts — an HTTP limit is one count for the whole cluster,
// kept across a deploy, still enforced while Redis is away, and stored under no caller's name.
//
// Instances are real server processes for the cluster's count. The outages run in this process,
// against Redis through a proxy that can stop it or leave it half-open.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { createClient } from "redis";
import { register } from "@prometheus-io/client";
import { connectRateLimits, routeLimiter } from "../../server/http/rateLimit.ts";
import { installClock, realClock } from "../../server/http/clock.ts";
import { closeRedis, keyspace, redisReady } from "../../server/store/redis.ts";
import { eventually } from "../helpers/client.ts";
import { boot, freePorts, stopInstance, type Instance } from "../helpers/instance.ts";
import { dropKeyspace } from "../helpers/redisKeys.ts";
import { dropSchema, hasDatabase, scopedDatabaseUrl, skipMessage } from "../helpers/testServer.ts";
import { startProxy, targetOf, viaProxy, type Proxy } from "../helpers/tcpProxy.ts";

const realRedis = process.env.REDIS_URL;

interface SharedKey {
  key: string;
  count: number;
  ttl: number;
}

async function sharedKeys(databaseUrl: string, name: string): Promise<SharedKey[]> {
  const redis = createClient({ url: realRedis });
  redis.on("error", () => {});
  await redis.connect();
  try {
    const found: SharedKey[] = [];
    for await (const batch of redis.scanIterator({ MATCH: `${keyspace(databaseUrl)}:limit:${name}:*` })) {
      for (const key of batch) found.push({ key, count: Number(await redis.get(key)), ttl: await redis.pTTL(key) });
    }
    return found;
  } finally {
    redis.destroy();
  }
}

async function deleteShared(databaseUrl: string, name: string): Promise<void> {
  const keys = (await sharedKeys(databaseUrl, name)).map((k) => k.key);
  if (!keys.length) return;
  const redis = createClient({ url: realRedis });
  redis.on("error", () => {});
  await redis.connect();
  try {
    await redis.del(keys);
  } finally {
    redis.destroy();
  }
}

describe("a limit across instances", { skip: hasDatabase() ? false : skipMessage() }, () => {
  const schema = `srl_x_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const baseUrl = process.env.DATABASE_URL!;
  const scoped = scopedDatabaseUrl(baseUrl, schema);
  const env = { REDIS_URL: realRedis!, MURLAN_PASSWORD_RESET_REQUEST_RATE_LIMIT: "3" };
  const instances: Instance[] = [];
  let spare: number;
  const email = `Reset.Victim.${Date.now()}@Example.test`;

  before(async () => {
    // Creates the schema the child-process servers are then pointed at.
    const admin = new pg.Pool({ connectionString: baseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.end();
    const ports = await freePorts(3);
    spare = ports[2];
    instances.push(await boot(ports[0], scoped, env), await boot(ports[1], scoped, env));
  });

  after(async () => {
    for (const i of instances) await stopInstance(i.child);
    await dropKeyspace(scoped, realRedis);
    await dropSchema(baseUrl, schema);
  });

  const requestReset = async (i: Instance) =>
    (
      await fetch(`http://127.0.0.1:${i.port}/api/auth/request-password-reset`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      })
    ).status;

  test("two instances share one count: request N+1 across both is refused, and Redis never holds the address", async () => {
    const [a, b] = instances;
    assert.deepEqual([await requestReset(a), await requestReset(b), await requestReset(a)], [200, 200, 200]);
    assert.equal(await requestReset(b), 429, "the second instance kept a count of its own");
    const keys = await sharedKeys(scoped, "passwordResetRequest");
    assert.equal(keys.length, 1);
    assert.ok(!keys[0].key.toLowerCase().includes(email.toLowerCase()), `the address is in Redis: ${keys[0].key}`);
  });

  test("an instance replaced, as a deploy does, keeps the count within the window", async () => {
    await stopInstance(instances[0].child);
    instances[0] = await boot(spare, scoped, env);
    assert.equal(await requestReset(instances[0]), 429, "the deploy reset the count");
  });
});

describe("a limit while Redis fails", { skip: hasDatabase() ? false : skipMessage() }, () => {
  const scoped = scopedDatabaseUrl(process.env.DATABASE_URL ?? "postgres://unused/murlan", `srl_${Date.now()}_${Math.floor(Math.random() * 1e6)}`);
  const env = { DATABASE_URL: process.env.DATABASE_URL, REDIS_URL: realRedis };
  const servers: { close(): Promise<void> }[] = [];
  let proxy: Proxy;
  let names = 0;
  const freshName = () => `t${++names}`;

  before(async () => {
    proxy = await startProxy(targetOf(realRedis!, 6379));
    process.env.REDIS_URL = viaProxy(realRedis!, proxy);
    process.env.DATABASE_URL = scoped;
    process.env.SESSION_SECRET ??= "shared-rate-limits-test-secret";
    connectRateLimits();
    assert.ok(await redisReady(), "the limiters' Redis connection never came up");
  });

  after(async () => {
    for (const s of servers) await s.close();
    closeRedis();
    await proxy?.close();
    process.env.REDIS_URL = env.REDIS_URL;
    if (env.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = env.DATABASE_URL;
    await dropKeyspace(scoped, realRedis);
  });

  /**
   * A limiter keyed by the signed-in user, served on a port of its own. The result sends as `user`;
   * `handle` picks the response's status, by default 200.
   */
  async function instance(
    name: string,
    defaultMax: number,
    { skipSuccessfulRequests, handle }: { skipSuccessfulRequests?: boolean; handle?: (req: express.Request) => Promise<number> } = {},
  ): Promise<(user?: string, headers?: Record<string, string>) => Promise<number>> {
    const app = express();
    app.use((req, _res, next) => {
      (req as { session?: unknown }).session = { userId: req.headers["x-test-user"] };
      next();
    });
    const limiter = routeLimiter({ name, windowMs: 60_000, defaultMax, keyBy: "session", skipSuccessfulRequests, message: { code: "RATE_LIMITED" } });
    app.get("/", limiter, async (req, res) => {
      res.status(handle ? await handle(req) : 200).json({});
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    servers.push({ close: () => new Promise<void>((resolve) => server.close(() => resolve())) });
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    return async (user = "ana", headers = {}) => (await fetch(url, { headers: { "x-test-user": user, ...headers } })).status;
  }

  const sharedCounts = async (name: string) => (await sharedKeys(scoped, name)).map((k) => k.count);

  async function fallbacks(): Promise<number> {
    const metric = await register.getSingleMetric("limiter_fallbacks_total")?.get();
    return (metric?.values ?? []).reduce((sum, v) => sum + v.value, 0);
  }

  for (const outage of ["stopped", "half-open"] as const) {
    test(`with Redis ${outage}, each instance's own count still limits, no caller is locked out, and Redis counts again once back`, { timeout: 60_000 }, async () => {
      assert.ok(await redisReady(), "the limiters' Redis connection never came back");
      const name = freshName();
      const send = await instance(name, 3);
      assert.equal(await send(), 200);
      assert.deepEqual(await sharedCounts(name), [1], "the count never reached Redis");
      const fallbacksBefore = await fallbacks();

      if (outage === "stopped") proxy.refuse(true);
      else proxy.blackholeExisting();
      const statuses = [await send(), await send(), await send()];
      assert.ok(statuses.every((s) => s < 500), `a request answered ${statuses.join(", ")}`);
      assert.deepEqual(statuses, [200, 200, 429], "the outage forgot what this instance had counted, or stopped limiting");
      assert.equal(await send("bes"), 200, "the outage refused a caller who had sent nothing");
      assert.ok((await fallbacks()) > fallbacksBefore, "limiter_fallbacks_total did not count the fallback");
      assert.deepEqual(await sharedCounts(name), [1], "a request was counted in Redis during the outage");

      if (outage === "stopped") proxy.refuse(false);
      const resumed = freshName();
      const fresh = await instance(resumed, 1_000);
      await eventually(
        async () => {
          assert.equal(await fresh(), 200);
          return (await sharedCounts(resumed)).length > 0;
        },
        "counting to resume on Redis",
        20_000,
      );
    });
  }

  test("a cluster count Redis lost is not a fresh budget: this instance's own count still holds", async () => {
    const name = freshName();
    const send = await instance(name, 2);
    assert.deepEqual([await send(), await send()], [200, 200]);
    await deleteShared(scoped, name);
    assert.equal(await send(), 429, "a flushed or restarted Redis handed out a fresh budget");
  });

  test("a successful request whose window ended in Redis mid-request leaves no key behind", async () => {
    const name = freshName();
    const send = await instance(name, 5, {
      skipSuccessfulRequests: true,
      handle: async (req) => {
        if (req.headers["x-outcome"] !== "refused") await deleteShared(scoped, name);
        return req.headers["x-outcome"] === "refused" ? 400 : 200;
      },
    });
    assert.equal(await send(), 200);
    // The take-back runs once the response has finished; a later request on the same key proves it ran.
    assert.equal(await send("bes", { "x-outcome": "refused" }), 400);
    const left = (await sharedKeys(scoped, name)).filter((k) => k.count !== 1);
    assert.deepEqual(left.filter((k) => k.ttl < 0), [], "a key outlives every window: it has no expiry");
    assert.deepEqual(left, [], "the take-back created a key of its own");
  });

  test("a request Redis never counted takes nothing back from Redis once it is back", { timeout: 30_000 }, async () => {
    const name = freshName();
    const send = await instance(name, 5, {
      skipSuccessfulRequests: true,
      handle: async (req) => {
        if (req.headers["x-outcome"] === "refused") return 400;
        proxy.refuse(false);
        await eventually(() => redisReady(100), "the limiters' Redis connection to come back", 10_000);
        return 200;
      },
    });
    assert.equal(await send("ana", { "x-outcome": "refused" }), 400);
    assert.deepEqual(await sharedCounts(name), [1]);

    proxy.refuse(true);
    assert.equal(await send(), 200);
    // As above: the next request lands after the take-back.
    assert.equal(await send("ana", { "x-outcome": "refused" }), 400);
    assert.deepEqual(await sharedCounts(name), [2], "a request counted only here was taken off the cluster's count");
  });

  test("a stalled event loop is not a slow Redis: the reply already in hand counts, and no limiter stops asking Redis", async () => {
    const stalled = freshName();
    const other = freshName();
    const app = express();
    // Runs after the limiter below has written its command and before its reply can be read, and
    // outlasts the limiter's deadline. The first request, unstalled, loads the limiter's scripts.
    const stall: express.RequestHandler = (req, _res, next) => {
      if (req.headers["x-stall"]) setImmediate(() => {
        const until = performance.now() + 150;
        while (performance.now() < until);
      });
      next();
    };
    app.get("/stalled", stall, routeLimiter({ name: stalled, windowMs: 60_000, defaultMax: 100, message: {} }), (_req, res) => {
      res.json({});
    });
    app.get("/other", routeLimiter({ name: other, windowMs: 60_000, defaultMax: 100, message: {} }), (_req, res) => {
      res.json({});
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    servers.push({ close: () => new Promise<void>((resolve) => server.close(() => resolve())) });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    assert.equal((await fetch(`${base}/stalled`)).status, 200);
    const fallbacksBefore = await fallbacks();
    assert.equal((await fetch(`${base}/stalled`, { headers: { "x-stall": "1" } })).status, 200);
    for (let i = 0; i < 5; i++) assert.equal((await fetch(`${base}/other`)).status, 200);
    assert.deepEqual(await sharedCounts(stalled), [2], "the stall dropped a count Redis had already answered");
    assert.deepEqual(await sharedCounts(other), [5], "one stall stopped every limiter asking Redis");
    assert.equal(await fallbacks(), fallbacksBefore);
  });

  test("a fake clock dated ahead leaves no limiter skipping Redis once it is gone", { timeout: 60_000 }, async () => {
    assert.ok(await redisReady(), "the limiters' Redis connection never came back");
    const send = await instance(freshName(), 1_000);
    const restore = installClock({ ...realClock, now: () => realClock.now() + 86_400_000 });
    try {
      proxy.blackholeExisting();
      for (let i = 0; i < 5; i++) assert.equal(await send(), 200);
    } finally {
      restore();
    }
    const resumed = freshName();
    const fresh = await instance(resumed, 1_000);
    await eventually(
      async () => {
        assert.equal(await fresh(), 200);
        return (await sharedCounts(resumed)).length > 0;
      },
      "counting to resume on Redis",
      20_000,
    );
  });
});
