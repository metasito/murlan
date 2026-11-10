// tests/integration/instanceInbox.test.ts — one instance's addressed stream, read by another
// instance's inbox on the real Redis: each message once and in order, and what was sent while the
// reader's link was down still arrives once it is back. The stream lives exactly as long as its
// reader: a send never makes one, so a send to an instance that is gone fails at once.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ClientOfflineError, createClient } from "redis";
import { eventually } from "../helpers/client.ts";
import { hasDatabase, skipMessage } from "../helpers/testServer.ts";
import { dropKeyspace } from "../helpers/redisKeys.ts";
import { startProxy, targetOf, viaProxy, type Proxy } from "../helpers/tcpProxy.ts";
import { openInbox, type Inbox, type InstanceMessage } from "../../server/store/instanceInbox.ts";
import { closeRedis, redisKey, redisReady } from "../../server/store/redis.ts";

describe("an instance's inbox", { skip: hasDatabase() ? false : skipMessage() }, () => {
  const baseUrl = process.env.DATABASE_URL!;
  const scoped = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}options=-c%20search_path%3Dinbox_${Date.now()}`;
  const redisUrl = process.env.REDIS_URL!;
  const b = randomUUID();
  const received: number[] = [];
  let proxy: Proxy;
  let sender: Inbox;
  let receiver: Inbox;
  let redis: ReturnType<typeof createClient>;
  const inboxOf = (id: string) => redisKey(`inbox:${id}`);
  const opened = (id: string) => eventually(async () => (await redis.exists(inboxOf(id))) === 1, `inbox ${id} to exist`);

  before(async () => {
    process.env.DATABASE_URL = scoped;
    redis = createClient({ url: redisUrl });
    await redis.connect();
    proxy = await startProxy(targetOf(redisUrl, 6379));
    sender = openInbox({ id: randomUUID() });
    receiver = openInbox({ id: b, url: viaProxy(redisUrl, proxy) });
    receiver.on("probe", (m: InstanceMessage) => {
      received.push(m.n as number);
    });
    await redisReady();
    await opened(b);
  });

  after(async () => {
    sender?.close();
    receiver?.close();
    closeRedis();
    await redis?.quit();
    await proxy?.close();
    await dropKeyspace(scoped);
    process.env.DATABASE_URL = baseUrl;
  });

  test("delivers each message once and in order", async () => {
    for (let n = 0; n < 50; n++) await sender.send(b, { kind: "probe", n });
    await eventually(() => received.length >= 50, "50 messages", 10_000);
    await new Promise((r) => setTimeout(r, 500));
    assert.deepEqual(received, Array.from({ length: 50 }, (_, n) => n));
  });

  test("delivers what was sent while the reader's link was down, once it is back", async () => {
    proxy.refuse(true);
    for (let n = 50; n < 70; n++) await sender.send(b, { kind: "probe", n });
    await new Promise((r) => setTimeout(r, 1_000));
    assert.equal(received.length, 50, "a message arrived over a link that was down");
    proxy.refuse(false);
    await eventually(() => received.length >= 70, "the 20 sent during the outage", 15_000);
    await new Promise((r) => setTimeout(r, 500));
    assert.deepEqual(received, Array.from({ length: 70 }, (_, n) => n));
  });

  test("a send to an instance that never had an inbox rejects within seconds and makes none", { timeout: 10_000 }, async () => {
    const gone = randomUUID();
    await assert.rejects(sender.send(gone, { kind: "probe", n: -1 }), /has no inbox/);
    assert.equal(await redis.exists(inboxOf(gone)), 0, "the send made a stream nobody reads");
  });

  test("an inbox closed gracefully is removed, and a send to it then rejects and makes none", async () => {
    const leaving = randomUUID();
    const inbox = openInbox({ id: leaving });
    await opened(leaving);
    await inbox.close();
    assert.equal(await redis.exists(inboxOf(leaving)), 0, "the stream outlived its reader's stop");
    await assert.rejects(sender.send(leaving, { kind: "probe", n: -1 }), /has no inbox/);
    assert.equal(await redis.exists(inboxOf(leaving)), 0, "the send made the stream again");
  });

  test("an offer reaches a kept inbox at once, and to one that is gone answers false and writes nothing", async () => {
    const gone = randomUUID();
    assert.equal(await sender.offer(gone, { kind: "probe", n: -1 }), false);
    assert.equal(await redis.exists(inboxOf(gone)), 0, "the offer made a stream nobody reads");
    const before = received.length;
    assert.equal(await sender.offer(b, { kind: "probe", n: received.length }), true);
    await eventually(() => received.length === before + 1, "the offered message");
  });

  test("a live inbox with no traffic outlives its stream's expiry, and comes back once the store lost it", { timeout: 20_000 }, async () => {
    const quiet = randomUUID();
    const inbox = openInbox({ id: quiet });
    try {
      await opened(quiet);
      const firstId = (await redis.xRange(inboxOf(quiet), "-", "+", { COUNT: 1 }))?.[0]?.id;
      assert.ok(firstId, "the reader's stream holds no boot entry");
      await redis.pExpire(inboxOf(quiet), 5_000);
      await eventually(async () => (await redis.pTTL(inboxOf(quiet))) > 60_000, "the reader to renew its stream", 10_000);
      const stillId = (await redis.xRange(inboxOf(quiet), "-", "+", { COUNT: 1 }))?.[0]?.id;
      assert.equal(stillId, firstId, "the stream expired under its reader and was made again");

      await redis.del(inboxOf(quiet));
      await eventually(async () => (await redis.exists(inboxOf(quiet))) === 1, "the reader to make its lost stream again", 10_000);
      const seen: number[] = [];
      inbox.on("probe", (m: InstanceMessage) => {
        seen.push(m.n as number);
      });
      await sender.send(quiet, { kind: "probe", n: 1 });
      await eventually(() => seen.length === 1, "a message to the stream made again");
    } finally {
      await inbox.close();
    }
  });

  test("a store that lost every stream still delivers every message sent meanwhile, in order", { timeout: 30_000 }, async () => {
    const a = randomUUID();
    const target = randomUUID();
    const from = openInbox({ id: a });
    const to = openInbox({ id: target });
    const seen: number[] = [];
    to.on("probe", (m: InstanceMessage) => {
      seen.push(m.n as number);
    });
    try {
      await Promise.all([opened(a), opened(target)]);
      await redis.del([inboxOf(a), inboxOf(target)]);
      const lost = Array.from({ length: 20 }, (_, n) => from.send(target, { kind: "probe", n }));
      const outcomes = await Promise.allSettled(lost);
      const after = Array.from({ length: 20 }, (_, n) => from.send(target, { kind: "probe", n: n + 20 }));
      outcomes.push(...(await Promise.allSettled(after)));
      assert.deepEqual(outcomes.filter((o) => o.status === "rejected").length, 0, "a send to a live instance was refused");
      await eventually(() => seen.length >= 40, "all 40 messages", 10_000);
      assert.deepEqual(seen, Array.from({ length: 40 }, (_, n) => n));
    } finally {
      await Promise.all([from.close(), to.close()]);
    }
  });

  test("a send that finds the inbox missing still lands before the next one, when the stream comes back between them", { timeout: 60_000 }, async () => {
    const target = randomUUID();
    const to = openInbox({ id: target });
    const seen: number[] = [];
    to.on("probe", (m: InstanceMessage) => {
      seen.push(m.n as number);
    });
    try {
      await opened(target);
      for (let round = 0; round < 50; round++) {
        const [top] = await redis.xRevRange(inboxOf(target), "+", "-", { COUNT: 1 });
        const past = Math.max(Number(top?.id.split("-")[0]), Date.now()) + 1_000;
        await redis.del(inboxOf(target));
        const first = sender.send(target, { kind: "probe", n: 2 * round });
        // An id past every one the reader has seen, as a stream made anew after a loss gets; a clock
        // reading would repeat the last round's ids when two rounds share a millisecond.
        await redis.xAdd(inboxOf(target), `${past}-0`, { m: JSON.stringify({ kind: "boot" }) });
        const second = sender.send(target, { kind: "probe", n: 2 * round + 1 });
        await Promise.all([first, second]);
        await eventually(() => seen.length === 2 * round + 2, `round ${round}'s two messages`);
      }
      assert.deepEqual(seen, Array.from({ length: 100 }, (_, n) => n), "a later send overtook one that found the inbox missing");
    } finally {
      await to.close();
    }
  });

  test("a message to an unreachable Redis is refused at once, not queued", async () => {
    const offline = openInbox({ id: randomUUID(), url: viaProxy(redisUrl, proxy) });
    try {
      proxy.refuse(true);
      await new Promise((r) => setTimeout(r, 100));
      await assert.rejects(offline.send(b, { kind: "probe", n: -1 }), ClientOfflineError, "the send was queued for Redis to come back");
    } finally {
      proxy.refuse(false);
      void offline.close();
    }
  });
});
