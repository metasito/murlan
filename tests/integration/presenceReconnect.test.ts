// tests/integration/presenceReconnect.test.ts — an account's presence entry follows its newest
// connection, whichever instance's presence link gets back to Redis first.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "redis";
import { eventually } from "../helpers/client.ts";
import { dropKeyspace } from "../helpers/redisKeys.ts";
import { hasDatabase, skipMessage } from "../helpers/testServer.ts";
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
const db = redisUrl ? Number(new URL(redisUrl).pathname.slice(1) || 0) : 0;
const presenceLinks = async () =>
  ((await admin.sendCommand(["CLIENT", "LIST"])) as string)
    .split("\n")
    .filter((line) => line.includes("name=murlan-presence") && line.includes(` db=${db} `))
    .map((line) => /id=(\d+)/.exec(line)![1]);
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

/** Cuts this process's presence link and resolves once it is back and has run its reconnect. */
async function reconnectPresence(): Promise<void> {
  const [killed] = (await presenceLinks()).filter((id) => !others.has(id));
  assert.ok(killed, "this process's presence link was not found");
  others.add(killed);
  await admin.sendCommand(["CLIENT", "KILL", "ID", killed]);
  await eventually(async () => (await presenceLinks()).some((id) => !others.has(id)), "the presence link reconnected");
  await eventually(() => instancesOf(["probe"]).then(() => true, () => false), "the presence link ready");
}

test("a reconnected presence link fills a missing entry and leaves a newer one alone", { skip }, async () => {
  recordPresence("moved", "s1", 100);
  recordPresence("lost", "s3", 100);
  await eventually(async () => (await instancesOf(["moved", "lost"])).size === 2, "both entries written");

  // While this instance's link is down, the account reconnects elsewhere, and Redis loses the other entry.
  await admin.hSet(presenceKey("moved"), { instance: "elsewhere", socket: "s2", at: "200" });
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
  // The account moved here as s2 while Redis was down, so this instance's own write was refused.
  recordPresence("ana", "s2", 200);
  await eventually(async () => (await instancesOf(["ana"])).size === 1, "the entry written");
  await dropKeyspace(scoped, redisUrl);
  // The instance it left gets back first and fills in its half-open socket, as its reconnect does.
  await admin.hSet(presenceKey("ana"), { instance: "left-behind", socket: "s1", at: "100" });
  await reconnectPresence();

  assert.equal((await instancesOf(["ana"])).get("ana"), instanceId, "the older connection's fill kept the account's entry");
  // That socket's ping timeout then clears what it believes is its own entry.
  forgetPresence("ana", "s1");
  assert.equal((await instancesOf(["ana"])).get("ana"), instanceId, "the account was left online with no entry");
});
