// tests/integration/presenceSelfHeal.test.ts — an account whose entry is lost while it is connected
// here is findable again within one heal interval, whatever order the instances recovered in.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "redis";
import { eventually } from "../helpers/client.ts";
import { dropKeyspace } from "../helpers/redisKeys.ts";
import { hasDatabase, skipMessage } from "../helpers/testServer.ts";
import { startProxy, targetOf, viaProxy, type Proxy } from "../helpers/tcpProxy.ts";
import {
  HEAL_CHUNK,
  PRESENCE_HEAL_MS,
  healChunks,
  closePresence,
  forgetPresence,
  instancesOf,
  openPresence,
  presenceKey,
  recordPresence,
} from "../../server/store/presence.ts";
import { closeRedis, instanceId } from "../../server/store/redis.ts";

const redisUrl = process.env.REDIS_URL;
const baseUrl = process.env.DATABASE_URL;
const skip = hasDatabase() ? false : skipMessage();
// Only the keyspace is read from it: no database is opened.
process.env.DATABASE_URL = `postgres://x@localhost/x?options=-c%20search_path%3Dheal_${Date.now().toString(36)}`;
const scoped = process.env.DATABASE_URL;

let proxy: Proxy | undefined;
after(async () => {
  closePresence();
  closeRedis();
  await proxy?.close();
  await dropKeyspace(scoped);
  process.env.DATABASE_URL = baseUrl;
});

const reachable = () => instancesOf(["probe"]).then(() => true, () => false);

test("a connect refused while Redis was away is in presence within one heal interval", { skip }, async () => {
  const admin = createClient({ url: redisUrl });
  admin.on("error", () => {});
  await admin.connect();
  try {
    proxy = await startProxy(targetOf(redisUrl!, 6379));
    openPresence(viaProxy(redisUrl!, proxy));
    await eventually(reachable, "the presence link up");

    // The instance the account was on stamped its socket, then Redis lost everything.
    const [seconds, micros] = (await admin.sendCommand(["TIME"])) as [string, string];
    const t1 = String(BigInt(seconds) * 1_000_000n + BigInt(micros));
    await dropKeyspace(scoped, redisUrl);

    // The account reconnects here while this instance cannot reach Redis: its write is refused.
    proxy.refuse(true);
    await eventually(async () => !(await reachable()), "the presence link down");
    recordPresence("ana", "s2");

    // The instance it left gets back first and puts its half-open socket back.
    await admin.hSet(presenceKey("ana"), { instance: "left-behind", socket: "s1", at: t1 });
    proxy.refuse(false);
    await eventually(reachable, "the presence link back");
    // That socket's ping timeout then clears what it believes is its own entry.
    forgetPresence("ana", "s1");

    const healed = await eventually(
      async () => ((await admin.hGet(presenceKey("ana"), "socket")) === "s2" ? admin.hGet(presenceKey("ana"), "instance") : null),
      "the entry naming the socket connected here",
      2 * PRESENCE_HEAL_MS
    ).catch(() => null);
    assert.equal(healed, instanceId, "the account stayed connected here with no entry pointing at it");
  } finally {
    admin.destroy();
  }
});

test("a heal is sent in pieces of at most HEAL_CHUNK entries, every entry in one of them", () => {
  const entries = Array.from({ length: 2 * HEAL_CHUNK + 1 }, (_, i) => i);
  const chunks = healChunks(entries);
  assert.deepEqual(chunks.map((c) => c.length), [HEAL_CHUNK, HEAL_CHUNK, 1]);
  assert.deepEqual(chunks.flat(), entries, "a piece dropped or reordered an entry");
  assert.deepEqual(healChunks([]), [[]], "a heal with nothing to fill still reads the clock");
});

test("more entries than one piece holds all come back", { skip }, async () => {
  const admin = createClient({ url: redisUrl });
  admin.on("error", () => {});
  await admin.connect();
  try {
    await eventually(reachable, "the presence link up");
    const users = Array.from({ length: HEAL_CHUNK + 200 }, (_, i) => `many${i}`);
    for (const userId of users) recordPresence(userId, `s-${userId}`);
    await eventually(async () => (await instancesOf(users)).size === users.length, "every entry written");
    await admin.del(users.map(presenceKey));

    const back = await eventually(
      async () => ((await instancesOf(users)).size === users.length ? true : null),
      "every entry healed",
      2 * PRESENCE_HEAL_MS
    ).catch(() => false);
    assert.equal(back, true, `only ${(await instancesOf(users)).size} of ${users.length} entries came back`);
  } finally {
    admin.destroy();
  }
});
