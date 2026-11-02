// tests/integration/presenceReconnect.test.ts — an account's presence entry follows its newest
// connection, whichever instance's presence link gets back to Redis first.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "redis";
import { eventually } from "../helpers/client.ts";
import { dropKeyspace } from "../helpers/redisKeys.ts";
import { hasDatabase, skipMessage } from "../helpers/testServer.ts";
import { startProxy, targetOf, viaProxy, type Proxy } from "../helpers/tcpProxy.ts";
import { closePresence, forgetPresence, instancesOf, openPresence, presenceKey, recordPresence } from "../../server/store/presence.ts";
import { closeRedis, instanceId } from "../../server/store/redis.ts";

const redisUrl = process.env.REDIS_URL;
const baseUrl = process.env.DATABASE_URL;
const skip = hasDatabase() ? false : skipMessage();
// Only the keyspace is read from it: no database is opened.
process.env.DATABASE_URL = `postgres://x@localhost/x?options=-c%20search_path%3Dpresence_${Date.now().toString(36)}`;
const scoped = process.env.DATABASE_URL;

after(async () => {
  closePresence();
  closeRedis();
  await dropKeyspace(scoped);
  process.env.DATABASE_URL = baseUrl;
});

const admin = createClient({ url: redisUrl });
admin.on("error", () => {});
/** This process's presence link alone runs through it, so cutting it touches no other suite's. */
let proxy: Proxy | undefined;
const reachable = () => instancesOf(["probe"]).then(() => true, () => false);

before(async () => {
  if (skip) return;
  await admin.connect();
  proxy = await startProxy(targetOf(redisUrl!, 6379));
  openPresence(viaProxy(redisUrl!, proxy));
  await eventually(reachable, "the presence link up");
});
after(async () => {
  if (admin.isOpen) admin.destroy();
  await proxy?.close();
});

/** Redis's own clock in microseconds, offset by `deltaMicros`: the clock every entry is stamped from. */
async function redisMicros(deltaMicros = 0n): Promise<string> {
  const [seconds, micros] = (await admin.sendCommand(["TIME"])) as [string, string];
  return String(BigInt(seconds) * 1_000_000n + BigInt(micros) + deltaMicros);
}

/** Cuts this process's presence link and resolves once it is back and has run its reconnect. */
async function reconnectPresence(): Promise<void> {
  proxy!.refuse(true);
  await eventually(async () => !(await reachable()), "the presence link down");
  proxy!.refuse(false);
  await eventually(reachable, "the presence link back");
}

test("a reconnected presence link fills a missing entry and leaves a newer one alone", { skip }, async () => {
  recordPresence("moved", "s1");
  recordPresence("lost", "s3");
  await eventually(async () => (await instancesOf(["moved", "lost"])).size === 2, "both entries written");

  // While this instance's link is down, the account reconnects elsewhere, and Redis loses the other entry.
  await admin.hSet(presenceKey("moved"), { instance: "elsewhere", socket: "s2", at: await redisMicros() });
  await admin.del(presenceKey("lost"));
  await reconnectPresence();

  const where = await instancesOf(["moved", "lost"]);
  assert.equal(where.get("moved"), "elsewhere", "the reconnect wrote its stale entry over the account's newer one");
  assert.equal(where.get("lost"), instanceId, "the reconnect did not put back the entry Redis lost");

  forgetPresence("moved", "s1");
  await instancesOf(["probe"]);
  assert.equal((await admin.hGetAll(presenceKey("moved"))).socket, "s2", "the stale socket's disconnect took the newer entry");
});

test("after Redis loses its data, the newest connection wins even when the older one's instance fills first", { skip }, async () => {
  recordPresence("ana", "s2");
  await eventually(async () => (await instancesOf(["ana"])).size === 1, "the entry written");
  await dropKeyspace(scoped, redisUrl);
  // The instance it left gets back first and fills in its half-open socket, stamped when it connected.
  await admin.hSet(presenceKey("ana"), { instance: "left-behind", socket: "s1", at: await redisMicros(-60_000_000n) });
  await reconnectPresence();

  assert.equal((await instancesOf(["ana"])).get("ana"), instanceId, "the older connection's fill kept the account's entry");
  // That socket's ping timeout then clears what it believes is its own entry.
  forgetPresence("ana", "s1");
  assert.equal((await instancesOf(["ana"])).get("ana"), instanceId, "the account was left online with no entry");
});

test("a connection always takes the entry, whatever any instance's own clock says", { skip }, async () => {
  // The instance it left stamped its socket later than this one's clock reads now.
  await admin.hSet(presenceKey("skew"), { instance: "ahead", socket: "s1", at: await redisMicros(3_600_000_000n) });
  recordPresence("skew", "s2");
  assert.equal(
    await eventually(async () => (await instancesOf(["skew"])).get("skew") === instanceId, "the connection written").catch(() => false),
    true,
    "a newer connection was refused for an older one's stamp"
  );
  forgetPresence("skew", "s1");
  assert.equal((await instancesOf(["skew"])).get("skew"), instanceId, "the account was left online with no entry");
});
