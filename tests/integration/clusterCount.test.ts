// tests/integration/clusterCount.test.ts — an instance that cannot be sure it heard every live
// peer says so, and never answers that it is alone.
//
// "Nobody else holds this table" is what lets a caller release a seat or take a table over, so a
// count that comes up short while a peer is alive and holding tables is a destructive answer. The
// count is short whenever a peer's subscriber is not subscribed at that moment: while its Redis
// link is down, and in the seconds while it resubscribes.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { Server } from "socket.io";
import { hasDatabase, skipMessage } from "../helpers/testServer.ts";
import { dropKeyspace } from "../helpers/redisKeys.ts";
import { startProxy, targetOf, viaProxy, type Proxy } from "../helpers/tcpProxy.ts";
import { createSocketAdapter } from "../../server/socket/socketAdapter.ts";
import { closeRedis, redisReady } from "../../server/store/redis.ts";

type Verdict = "answered" | "error" | "alone";

describe("the cluster's count of its peers", { skip: hasDatabase() ? false : skipMessage() }, () => {
  const baseUrl = process.env.DATABASE_URL!;
  const scoped = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}options=-c%20search_path%3Dcount_${Date.now()}`;
  const redisUrl = process.env.REDIS_URL!;
  let proxy: Proxy;
  let a: Server;
  let b: Server;

  const ask = (from: Server) =>
    new Promise<Verdict>((resolve) =>
      from.serverSideEmit("probe", (err: unknown, replies: unknown[]) =>
        resolve(replies.length > 0 ? "answered" : err ? "error" : "alone")
      )
    );
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  before(async () => {
    process.env.DATABASE_URL = scoped;
    proxy = await startProxy(targetOf(redisUrl, 6379));
    process.env.REDIS_URL = viaProxy(redisUrl, proxy);
    a = new Server();
    a.adapter(createSocketAdapter());
    process.env.REDIS_URL = redisUrl;
    b = new Server();
    b.adapter(createSocketAdapter());
    for (const io of [a, b]) io.on("probe", (reply: (r: string) => void) => reply("mine"));
    await redisReady();
  });

  after(async () => {
    // Neither is attached to an http server, so `io.close()` has no engine to close.
    for (const io of [a, b]) await io?.of("/").adapter.close();
    closeRedis();
    await proxy?.close();
    await dropKeyspace(scoped);
    process.env.DATABASE_URL = baseUrl;
    process.env.REDIS_URL = redisUrl;
  });

  test("each instance hears the other while the link is up", async () => {
    assert.deepEqual(await Promise.all([ask(a), ask(b)]), ["answered", "answered"]);
  });

  test("during and right after a 1.5 s outage of one link, nobody is told it is alone", { timeout: 60_000 }, async () => {
    proxy.refuse(true);
    const asked: Promise<Verdict>[] = [];
    const sockets: Promise<unknown>[] = [];
    for (let i = 0; i < 15; i++) {
      asked.push(ask(a), ask(b));
      sockets.push(b.fetchSockets().then(() => "alone", () => "error"));
      await sleep(100);
    }
    proxy.refuse(false);
    for (let i = 0; i < 60; i++) {
      asked.push(ask(a), ask(b));
      await sleep(50);
    }
    const verdicts = await Promise.all(asked);
    assert.equal(verdicts.filter((v) => v === "alone").length, 0, `told it was alone: ${JSON.stringify(verdicts)}`);
    assert.deepEqual([...new Set(await Promise.all(sockets))], ["error"], "fetchSockets answered from this instance alone");
    assert.deepEqual(await Promise.all([ask(a), ask(b)]), ["answered", "answered"], "the two never heard each other again");
  });
});
