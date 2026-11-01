// tests/integration/instanceInbox.test.ts — one instance's addressed stream, read by another
// instance's inbox on the real Redis: each message once and in order, and what was sent while the
// reader's link was down still arrives once it is back.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eventually } from "../helpers/client.ts";
import { hasDatabase, skipMessage } from "../helpers/testServer.ts";
import { dropKeyspace } from "../helpers/redisKeys.ts";
import { startProxy, targetOf, viaProxy, type Proxy } from "../helpers/tcpProxy.ts";
import { openInbox, type Inbox, type InstanceMessage } from "../../server/store/instanceInbox.ts";
import { closeRedis } from "../../server/store/redis.ts";

describe("an instance's inbox", { skip: hasDatabase() ? false : skipMessage() }, () => {
  const baseUrl = process.env.DATABASE_URL!;
  const scoped = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}options=-c%20search_path%3Dinbox_${Date.now()}`;
  const redisUrl = process.env.REDIS_URL!;
  const b = randomUUID();
  const received: number[] = [];
  let proxy: Proxy;
  let sender: Inbox;
  let receiver: Inbox;

  before(async () => {
    process.env.DATABASE_URL = scoped;
    proxy = await startProxy(targetOf(redisUrl, 6379));
    sender = openInbox({ id: randomUUID() });
    receiver = openInbox({ id: b, url: viaProxy(redisUrl, proxy) });
    receiver.on("probe", (m: InstanceMessage) => {
      received.push(m.n as number);
    });
  });

  after(async () => {
    sender?.close();
    receiver?.close();
    closeRedis();
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

  test("a message to an unreachable Redis is refused at once, not queued", async () => {
    const offline = openInbox({ id: randomUUID(), url: viaProxy(redisUrl, proxy) });
    try {
      proxy.refuse(true);
      await new Promise((r) => setTimeout(r, 100));
      const started = Date.now();
      await assert.rejects(offline.send(b, { kind: "probe", n: -1 }));
      assert.ok(Date.now() - started < 500, "the send waited for Redis to come back");
    } finally {
      proxy.refuse(false);
      offline.close();
    }
  });
});
