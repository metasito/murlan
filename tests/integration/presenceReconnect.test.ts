// tests/integration/presenceReconnect.test.ts — an account's presence entry follows its newest
// connection, whichever instance's presence link gets back to Redis first.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "redis";
import { eventually } from "../helpers/client.ts";
import { dropKeyspace } from "../helpers/redisKeys.ts";
import { hasDatabase, skipMessage } from "../helpers/testServer.ts";
import { startProxy, targetOf, viaProxy } from "../helpers/tcpProxy.ts";
import {
  closePresence,
  forgetPresence,
  instancesOf,
  openPresence,
  openPresenceStore,
  presenceKey,
  recordPresence,
} from "../../server/store/presence.ts";
import { closeRedis, instanceId, keyspace, redisReady } from "../../server/store/redis.ts";

const redisUrl = process.env.REDIS_URL;
const baseUrl = process.env.DATABASE_URL;
const skip = hasDatabase() ? false : skipMessage();
// Only the keyspace is read from it: no database is opened.
process.env.DATABASE_URL = `postgres://x@localhost/x?options=-c%20search_path%3Dpresence_${Date.now().toString(36)}`;
const scoped = process.env.DATABASE_URL;
const ns = keyspace(scoped);

after(async () => {
  closePresence();
  closeRedis();
  await dropKeyspace(scoped);
  process.env.DATABASE_URL = baseUrl;
});

const admin = createClient({ url: redisUrl });
admin.on("error", () => {});
const db = redisUrl ? Number(new URL(redisUrl).pathname.slice(1) || 0) : 0;
const presenceLinks = async () =>
  ((await admin.sendCommand(["CLIENT", "LIST"])) as string)
    .split("\n")
    .filter((line) => line.includes("name=murlan-presence") && line.includes(` db=${db} `))
    .map((line) => /id=(\d+)/.exec(line)![1]!);
/** Links that are not this process's: other suites on the same database. */
let others = new Set<string>();

before(async () => {
  if (skip) return;
  await admin.connect();
  others = new Set(await presenceLinks());
  openPresence(redisUrl);
  await eventually(() => instancesOf(["probe"]).then(() => true, () => false), "the presence link up");
});
after(() => {
  if (admin.isOpen) admin.destroy();
});

/** Redis's own clock in microseconds, offset by `deltaMicros`: the clock every entry is stamped from. */
async function redisMicros(deltaMicros = 0n): Promise<bigint> {
  const [seconds, micros] = (await admin.sendCommand(["TIME"])) as [string, string];
  return BigInt(seconds) * 1_000_000n + BigInt(micros) + deltaMicros;
}

/** An entry another instance wrote, with liveness so it reads as online. */
async function elsewhere(userId: string, instance: string, socket: string, at: bigint): Promise<void> {
  await admin.set(`${ns}:instance:${instance}`, "1", { PX: 60_000 });
  await admin.set(presenceKey(userId), `${instance}|${socket}|${at}`);
}

/** Cuts this process's presence links and resolves once they are back and have run their reconnect. */
async function reconnectPresence(): Promise<void> {
  const ours = (await presenceLinks()).filter((id) => !others.has(id));
  assert.ok(ours.length > 0, "this process's presence links were not found");
  for (const id of ours) {
    others.add(id);
    await admin.sendCommand(["CLIENT", "KILL", "ID", id]);
  }
  await eventually(async () => (await presenceLinks()).filter((id) => !others.has(id)).length >= ours.length, "the presence links reconnected");
  await eventually(() => instancesOf(["probe"]).then(() => true, () => false), "the presence link ready");
}

test("a reconnected presence link fills a missing entry and leaves a newer one alone", { skip }, async () => {
  recordPresence("moved", "s1");
  recordPresence("lost", "s3");
  await eventually(async () => (await instancesOf(["moved", "lost"])).size === 2, "both entries written");

  // While this instance's link is down, the account reconnects elsewhere, and Redis loses the other entry.
  await elsewhere("moved", "elsewhere", "s2", await redisMicros());
  await admin.del(presenceKey("lost"));
  await reconnectPresence();

  const where = await eventually(async () => {
    const found = await instancesOf(["moved", "lost"]);
    return found.size === 2 ? found : null;
  }, "the missing entry put back");
  assert.equal(where.get("moved"), "elsewhere", "the reconnect wrote its stale entry over the account's newer one");
  assert.equal(where.get("lost"), instanceId, "the reconnect did not put back the entry Redis lost");

  forgetPresence("moved", "s1");
  await instancesOf(["probe"]);
  assert.equal((await admin.get(presenceKey("moved")))?.split("|")[1], "s2", "the stale socket's disconnect took the newer entry");
});

test("after Redis loses its data, the newest connection wins even when the older one's instance fills first", { skip }, async () => {
  recordPresence("ana", "s2");
  await eventually(async () => (await instancesOf(["ana"])).size === 1, "the entry written");
  await dropKeyspace(scoped, redisUrl);
  // The instance it left gets back first and fills in its half-open socket, stamped when it connected.
  await elsewhere("ana", "left-behind", "s1", await redisMicros(-60_000_000n));
  await reconnectPresence();

  await eventually(async () => (await instancesOf(["ana"])).get("ana") === instanceId, "the newer connection's fill");
  // That socket's ping timeout then clears what it believes is its own entry.
  forgetPresence("ana", "s1");
  assert.equal((await instancesOf(["ana"])).get("ana"), instanceId, "the account was left online with no entry");
});

test("a connection always takes the entry, whatever any instance's own clock says", { skip }, async () => {
  // The instance it left stamped its socket later than this one's clock reads now.
  await elsewhere("skew", "ahead", "s1", await redisMicros(3_600_000_000n));
  recordPresence("skew", "s2");
  assert.equal(
    await eventually(async () => (await instancesOf(["skew"])).get("skew") === instanceId, "the connection written").catch(() => false),
    true,
    "a newer connection was refused for an older one's stamp"
  );
  forgetPresence("skew", "s1");
  assert.equal((await instancesOf(["skew"])).get("skew"), instanceId, "the account was left online with no entry");
});

test("a connect Redis refused is filled with this instance's newest stamp, behind a newer connection elsewhere", { skip }, async () => {
  const proxy = await startProxy(targetOf(redisUrl!, 6379));
  try {
    const store = openPresenceStore({ id: "refused", ns, url: viaProxy(redisUrl!, proxy), heartbeat: false });
    await redisReady();
    await store.beat();
    proxy.refuse(true);
    await eventually(() => store.locate(["probe"]).then(() => false, () => true), "the link down");
    store.record("cat", "s-refused");
    store.record("dov", "s-refused-2");
    // Meanwhile the first account connects elsewhere, later than any stamp this instance holds.
    await elsewhere("cat", "newer", "s-newer", await redisMicros(1_000_000n));
    proxy.refuse(false);
    await eventually(() => store.beat().then(() => true, () => false), "a beat to land");

    assert.equal((await admin.get(presenceKey("cat")))?.split("|")[0], "newer", "a refused connect's fill took a newer connection's entry");
    await eventually(async () => (await admin.get(presenceKey("dov")))?.split("|")[0] === "refused", "the refused connect filled in");
    store.close();
  } finally {
    await proxy.close();
  }
});
