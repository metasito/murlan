// tests/integration/sharedRateLimits.test.ts — an HTTP limit is one count for the whole cluster,
// kept across a deploy, and still enforced while Redis is away.
//
// Two limiters built under one name stand in for two instances, or for one instance before and
// after a deploy: each is its own express-rate-limit with its own store, as a second process
// would have. Redis is reached through a proxy that can stop it or leave it half-open.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { createClient } from "redis";
import { register } from "prom-client";
import { connectRateLimits, routeLimiter } from "../../server/http/rateLimit.ts";
import { closeRedis, keyspace, redisReady } from "../../server/store/redis.ts";
import { eventually } from "../helpers/client.ts";
import { dropKeyspace } from "../helpers/redisKeys.ts";
import { hasDatabase, scopedDatabaseUrl, skipMessage } from "../helpers/testServer.ts";
import { startProxy, targetOf, viaProxy, type Proxy } from "../helpers/tcpProxy.ts";

const realRedis = process.env.REDIS_URL;

describe("shared HTTP rate limits", { skip: hasDatabase() ? false : skipMessage() }, () => {
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

  /** A limiter keyed by the signed-in user, served on a port of its own; the result sends as `user`. */
  async function instance(name: string, defaultMax: number): Promise<(user?: string) => Promise<number>> {
    const app = express();
    app.use((req, _res, next) => {
      (req as { session?: unknown }).session = { userId: req.headers["x-test-user"] };
      next();
    });
    app.get("/", routeLimiter({ name, windowMs: 60_000, defaultMax, keyBy: "session", message: { code: "RATE_LIMITED" } }), (_req, res) => {
      res.json({ ok: true });
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    servers.push({ close: () => new Promise<void>((resolve) => server.close(() => resolve())) });
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    return async (user = "ana") => (await fetch(url, { headers: { "x-test-user": user } })).status;
  }

  async function sharedCounts(name: string): Promise<number[]> {
    const redis = createClient({ url: realRedis });
    redis.on("error", () => {});
    await redis.connect();
    try {
      const counts: number[] = [];
      for await (const batch of redis.scanIterator({ MATCH: `${keyspace(scoped)}:limit:${name}:*` })) {
        for (const key of batch) counts.push(Number(await redis.get(key)));
      }
      return counts;
    } finally {
      redis.destroy();
    }
  }

  async function fallbacks(): Promise<number> {
    const metric = await register.getSingleMetric("limiter_fallbacks_total")?.get();
    return (metric?.values ?? []).reduce((sum, v) => sum + v.value, 0);
  }

  test("two instances share one count: request N+1 across both is refused", async () => {
    const name = freshName();
    const a = await instance(name, 3);
    const b = await instance(name, 3);
    assert.deepEqual([await a(), await b(), await a()], [200, 200, 200]);
    assert.equal(await b(), 429, "the second instance kept a count of its own");
    assert.equal(await a(), 429);
  });

  test("a limiter rebuilt, as a deploy does, keeps its count within the window", async () => {
    const name = freshName();
    const before = await instance(name, 2);
    assert.deepEqual([await before(), await before()], [200, 200]);
    const after = await instance(name, 2);
    assert.equal(await after(), 429, "the deploy reset the count");
  });

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
    const redis = createClient({ url: realRedis });
    redis.on("error", () => {});
    await redis.connect();
    try {
      for await (const batch of redis.scanIterator({ MATCH: `${keyspace(scoped)}:limit:${name}:*` })) if (batch.length) await redis.del(batch);
    } finally {
      redis.destroy();
    }
    assert.equal(await send(), 429, "a flushed or restarted Redis handed out a fresh budget");
  });
});
