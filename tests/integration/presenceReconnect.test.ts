// tests/integration/presenceReconnect.test.ts — an instance putting its entries back never takes
// an account's entry from the instance it has since connected to.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "redis";
import { eventually } from "../helpers/client.ts";
import { dropKeyspace } from "../helpers/redisKeys.ts";
import { hasDatabase, skipMessage } from "../helpers/testServer.ts";
import { closePresence, forgetPresence, instancesOf, openPresence, presenceKey, recordPresence } from "../../server/store/presence.ts";
import { closeRedis, instanceId, keyspace } from "../../server/store/redis.ts";

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

test("a reconnected presence link fills a missing entry and leaves a newer one alone", { skip }, async () => {
  const admin = createClient({ url: redisUrl });
  admin.on("error", () => {});
  await admin.connect();
  try {
    const db = Number(new URL(redisUrl!).pathname.slice(1) || 0);
    const presenceLinks = async () =>
      ((await admin.sendCommand(["CLIENT", "LIST"])) as string)
        .split("\n")
        .filter((line) => line.includes("name=murlan-presence") && line.includes(` db=${db} `))
        .map((line) => /id=(\d+)/.exec(line)![1]);
    const others = new Set(await presenceLinks());
    openPresence(redisUrl);
    await eventually(() => instancesOf(["probe"]).then(() => true, () => false), "the presence link up");
    recordPresence("moved", "s1");
    recordPresence("lost", "s3");
    await eventually(async () => (await instancesOf(["moved", "lost"])).size === 2, "both entries written");

    // While this instance's link is down, the account reconnects elsewhere, and Redis loses the other entry.
    await admin.set(presenceKey("moved"), "elsewhere|s2");
    await admin.set(`${keyspace(scoped)}:instance:elsewhere`, "1", { PX: 60_000 });
    await admin.del(presenceKey("lost"));
    const ours = async () => (await presenceLinks()).filter((id) => !others.has(id));
    const [killed] = await ours();
    assert.ok(killed, "this process's presence link was not found");
    others.add(killed);
    await admin.sendCommand(["CLIENT", "KILL", "ID", killed]);
    await eventually(async () => (await ours()).length > 0, "the presence link reconnected");

    const where = await eventually(
      () => instancesOf(["moved", "lost"]).catch(() => null),
      "the presence link back"
    );
    assert.equal(where.get("moved"), "elsewhere", "the reconnect wrote its stale entry over the account's newer one");
    assert.equal(where.get("lost"), instanceId, "the reconnect did not put back the entry Redis lost");

    forgetPresence("moved", "s1");
    await eventually(async () => (await instancesOf(["lost"])).size === 1, "the clear processed");
    assert.equal(await admin.get(presenceKey("moved")), "elsewhere|s2");
  } finally {
    admin.destroy();
  }
});
