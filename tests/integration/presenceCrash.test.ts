// tests/integration/presenceCrash.test.ts — a `kill -9`ed instance's players, as the instance left
// running sees them.
//
// Nothing runs on a process killed outright: no disconnect handler, no offline notice. Its players'
// presence entries outlive it, and only another instance's sweep of the dead one's liveness clears
// them and tells their friends (server/store/presence.ts). The players left online meanwhile cost
// no periodic write.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createClient } from "redis";
import { connectSocket as connectTo, eventually, waitFor, waitForWhere, type TestSocket } from "../helpers/client.ts";
import { dropSchema, hasDatabase, scopedDatabaseUrl, skipMessage } from "../helpers/testServer.ts";
import { dropKeyspace } from "../helpers/redisKeys.ts";
import { keyspace } from "../../server/store/redis.ts";
import { accountOn, at, befriendOn, boot, stopInstance, type Instance } from "../helpers/instance.ts";
import { CLOCK_CEILING_MS } from "../../shared/clock.ts";

const PORTS: number[] = [];

describe("an instance killed outright", { skip: hasDatabase() ? false : skipMessage() }, () => {
  const schema = `prescr_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const baseUrl = process.env.DATABASE_URL!;
  const scoped = scopedDatabaseUrl(baseUrl, schema);
  const ks = keyspace(scoped);
  const instances: Instance[] = [];
  const sockets: TestSocket[] = [];
  const tag = Date.now().toString(36);

  before(async () => {
    // Creates the schema the child-process servers are then pointed at.
    const admin = new pg.Pool({ connectionString: baseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.end();
    for (let n = 0; n < 2; n++) instances.push(await boot(scoped, { MURLAN_AFK_TIMEOUT_MS: String(CLOCK_CEILING_MS) }));
    PORTS.push(...instances.map((i) => i.port));
  });

  after(async () => {
    for (const s of sockets) s.close();
    for (const i of instances) await stopInstance(i.child);
    try {
      await dropKeyspace(scoped);
      await dropSchema(baseUrl, schema);
    } finally {
      process.env.DATABASE_URL = baseUrl;
    }
  });

  test("a killed instance's players read offline and their friends are told, and online players cost no periodic writes", { timeout: 150_000 }, async () => {
    const watcherName = `cw${tag}`;
    const lostName = `cl${tag}`;
    const watcher = await accountOn(PORTS[0], watcherName);
    const lost = await accountOn(PORTS[0], lostName);
    await befriendOn(PORTS[0], watcher, lost, lostName);
    const watching = await connectTo(at(PORTS[0]), { cookie: watcher.cookie });
    sockets.push(watching);
    sockets.push(await connectTo(at(PORTS[1]), { cookie: lost.cookie }));
    await eventually(async () => {
      const list = waitFor(watching, "friend:online_list");
      watching.emit("friend:get_online_list", {});
      return (await list).onlineIds.includes(lost.id);
    }, "the friend on the other instance to read online");

    const offline = waitForWhere(watching, "friend:status", (s) => s.userId === lost.id && !s.online, 15_000);
    await stopInstance(instances[1]!.child);
    const notice = await offline;
    assert.ok(notice.lastSeen, "the offline notice carried no last-seen time");
    const list = waitFor(watching, "friend:online_list");
    watching.emit("friend:get_online_list", {});
    assert.deepEqual((await list).onlineIds, [], "the killed instance's player still reads online");

    const monitor = createClient({ url: process.env.REDIS_URL });
    monitor.on("error", () => {});
    await monitor.connect();
    const writes: string[] = [];
    const WRITE = /^"(?:set|sadd|srem|del|incr|hset|hdel|expire|pexpire|xadd|mset|getdel)"$/i;
    await monitor.monitor((line: string) => {
      const args = line.slice(line.indexOf("]") + 2).split(" ");
      if (WRITE.test(args[0] ?? "") && args.some((a) => a.includes(ks))) writes.push(args.slice(0, 2).join(" "));
    });
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    monitor.destroy();
    const perUser = writes.filter((w) => !/:instance:|:instances"|:social-epoch"/.test(w) && !/^"pexpire" "[^"]*:inbox:/i.test(w));
    assert.deepEqual(perUser, [], "an online player cost a periodic write");
    assert.ok(writes.length > 0, "the monitor saw not even the heartbeat, so it saw nothing");
  });
});
