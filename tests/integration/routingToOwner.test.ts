// tests/integration/routingToOwner.test.ts — a forwarded intent goes to the table's owner alone.
//
// Three servers on one schema: A owns the table and reaches Redis through a proxy that can stall
// it, B holds the other player, and C holds nobody. A forward from B is one message to A and one
// answer back; C hears neither, and an A that stops reading answers B within the client's budget.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createClient } from "redis";
import type { Socket } from "socket.io-client";
import { ackUnchecked, connectAs, settled, waitFor, type TestSocket } from "../helpers/client.ts";
import { dropSchema, hasDatabase, scopedDatabaseUrl, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { boot, freePorts, type Instance } from "../helpers/instance.ts";
import { dropKeyspace } from "../helpers/redisKeys.ts";
import { startProxy, targetOf, viaProxy, type Proxy } from "../helpers/tcpProxy.ts";
import { keyspace } from "../../server/store/redis.ts";

const METRICS_TOKEN = "routing-metrics";
/**
 * Under the client's 4 s per try (`lib/sendIntent.ts`), with room for the socket hops. Not scaled
 * for a slow runner: the router's own timers spend 3.12 s of it whatever the machine.
 */
const UNREACHABLE_WITHIN_MS = 3_500;
/** Scaled by `ackUnchecked` on a slow runner. */
const LOCAL_ROUND_TRIP_MS = 100;

describe("an intent for a table another instance owns", { skip: hasDatabase() ? false : skipMessage() }, () => {
  const schema = `route_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const baseUrl = process.env.DATABASE_URL!;
  const scoped = scopedDatabaseUrl(baseUrl, schema);
  const instances: Instance[] = [];
  const sockets: TestSocket[] = [];
  let proxy: Proxy;
  let ports: number[];
  let host: TestSocket;
  let guest: TestSocket;
  let guestId = "";
  let bystanderId = "";
  let roomId = "";

  const newRedis = () => createClient({ url: process.env.REDIS_URL });
  async function withRedis<T>(read: (redis: ReturnType<typeof newRedis>, key: (name: string) => string) => Promise<T>): Promise<T> {
    const redis = newRedis();
    redis.on("error", () => {});
    await redis.connect();
    try {
      return await read(redis, (name) => `${keyspace(scoped)}:${name}`);
    } finally {
      redis.destroy();
    }
  }
  const instanceOf = (userId: string) =>
    withRedis((redis, key) => redis.hGet(key(`presence:${userId}`), "instance")).then((id) => {
      assert.ok(id, `${userId} has no presence entry`);
      return id;
    });
  const inboxLength = (instance: string) => withRedis((redis, key) => redis.xLen(key(`inbox:${instance}`)));
  async function adapterMessages(port: number): Promise<number> {
    const res = await fetch(`http://127.0.0.1:${port}/metrics`, { headers: { authorization: `Bearer ${METRICS_TOKEN}` } });
    const text = await res.text();
    assert.equal(res.status, 200, text);
    const line = /^cluster_messages_total\{channel="adapter"\} (\d+)/m.exec(text);
    return Number(line?.[1] ?? 0);
  }

  before(async () => {
    // Creates the schema the child-process servers are then pointed at.
    const admin = new pg.Pool({ connectionString: baseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.end();
    proxy = await startProxy(targetOf(process.env.REDIS_URL!, 6379));
    ports = await freePorts(3);
    const env = { MURLAN_AFK_TIMEOUT_MS: "600000", METRICS_TOKEN };
    // Sequentially: each runs `ensureSchema` against the same schema.
    instances.push(await boot(ports[0], scoped, { ...env, REDIS_URL: viaProxy(process.env.REDIS_URL!, proxy) }));
    instances.push(await boot(ports[1], scoped, env));
    instances.push(await boot(ports[2], scoped, env));

    const tag = Date.now().toString(36);
    const at = (port: number) => ({ url: `http://127.0.0.1:${port}` }) as TestServer;
    host = (await connectAs(at(ports[0]), `rh${tag}`)).socket;
    const guestAccount = await connectAs(at(ports[1]), `rg${tag}`);
    guest = guestAccount.socket;
    guestId = guestAccount.user.id;
    const bystander = await connectAs(at(ports[2]), `rb${tag}`);
    bystanderId = bystander.user.id;
    sockets.push(host, guest, bystander.socket);
    const created = waitFor(host, "room:state");
    host.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
    const room = await created;
    roomId = room.roomId;
    const joined = waitFor(host, "room:state");
    guest.emit("room:join", { code: room.code });
    await joined;
    const dealt = waitFor(guest, "game:state", 15_000);
    host.emit("room:start", {});
    assert.ok(await dealt, "the game never started");
    await settled(guest);
    await settled(host);
  });

  after(async () => {
    for (const s of sockets) s.close();
    for (const i of instances) i.child.kill("SIGKILL");
    await proxy?.close();
    await dropKeyspace(scoped);
    await dropSchema(baseUrl, schema);
  });

  test("is one message to the owner's inbox and one answer back, and the third instance reads neither", async () => {
    const record = await withRedis((redis, key) => redis.get(key(`table-owner:${roomId}`)));
    assert.ok(record, "the table has no owner record");
    const instances = [record.split(":")[0]!, await instanceOf(guestId), await instanceOf(bystanderId)];
    assert.equal(new Set(instances).size, 3, "the owner, the asker and the bystander are not three instances");
    const inboxesBefore = await Promise.all(instances.map(inboxLength));
    const adapterBefore = await Promise.all(ports.map(adapterMessages));

    const heard = waitFor(host, "game:reaction");
    const reply = await ackUnchecked(guest, "game:reaction", [{ emoji: "👍" }], LOCAL_ROUND_TRIP_MS);
    assert.deepEqual(reply, { ok: true });
    assert.ok(await heard, "the owner never applied the reaction");

    const [owner, asker, bystanderInbox] = (await Promise.all(instances.map(inboxLength))).map((n, i) => n - inboxesBefore[i]!);
    assert.equal(owner, 1, "the owner's inbox did not get the intent, once");
    // The answer, and the reaction the owner sends the guest.
    assert.equal(asker, 2, "the asker's inbox did not get one answer and one reaction");
    assert.equal(bystanderInbox, 0, "the third instance was sent part of the forward");
    assert.deepEqual(await Promise.all(ports.map(adapterMessages)), adapterBefore, "the forward went out on the adapter stream every instance reads");
  });

  test("is answered TABLE_UNREACHABLE within the client's budget when the owner stops reading", { timeout: 30_000 }, async () => {
    assert.ok(proxy.blackholeExisting() > 0, "A holds no Redis connection to stall");
    const reply = await (guest as unknown as Socket).timeout(UNREACHABLE_WITHIN_MS).emitWithAck("game:rejoin", { roomId });
    assert.deepEqual(reply, { ok: false, code: "TABLE_UNREACHABLE" });
  });
});
