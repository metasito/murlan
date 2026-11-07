// tests/integration/presenceCluster.test.ts — presence across two real servers, read from Redis.
//
// Presence was derived from the cluster's sockets: every connect swept every instance with
// `fetchSockets()`, the reply carried each remote socket's handshake (its cookie and ticket among
// them), and a crashed instance's players read online until a heartbeat said otherwise while
// their friends were never told. This counts what one connect costs with 100 sockets on the other
// instance, and what a revocation sends.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createClient } from "redis";
import { decode } from "@msgpack/msgpack";
import { connectSocket as connectTo, waitFor, waitForOrNull, type TestSocket } from "../helpers/client.ts";
import { dropSchema, hasDatabase, scopedDatabaseUrl, skipMessage } from "../helpers/testServer.ts";
import { dropKeyspace } from "../helpers/redisKeys.ts";
import { keyspace } from "../../server/store/redis.ts";
import { accountOn, at, befriendOn, boot, stopInstance, type Instance } from "../helpers/instance.ts";

const PORTS: number[] = [];
const FETCH_SOCKETS = "7";
const FETCH_SOCKETS_RESPONSE = 8;
const SERVER_SIDE_EMIT = "9";
/** What a swept handshake carried; none of it may cross instances. */
const HANDSHAKE = /handshake|cookie|connect\.sid|"ticket"|"sid"/;
const ON_B = 100;

describe("presence across two instances", { skip: hasDatabase() ? false : skipMessage(), timeout: 240_000 }, () => {
  const schema = `prescl_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const baseUrl = process.env.DATABASE_URL!;
  const scoped = scopedDatabaseUrl(baseUrl, schema);
  const ks = keyspace(scoped);
  const stream = `${ks}:socket.io`;
  const probe = createClient({ url: process.env.REDIS_URL });
  const tap = createClient({ url: process.env.REDIS_URL });
  for (const c of [probe, tap]) c.on("error", () => {});
  /** Every pub/sub message the adapters sent each other, as received: requests that want replies, and the replies. */
  const published: { at: number; text: string; type: number | undefined }[] = [];
  const instances: Instance[] = [];
  const sockets: TestSocket[] = [];
  const tag = Date.now().toString(36);

  /** Everything instances sent each other since `from`: the adapter's stream, its replies, and every inbox. */
  async function sentSince(from: number) {
    const range = async (key: string) => ((await probe.xRange(key, String(from), "+")) ?? []).flatMap((e) => (e ? [e] : []));
    const entries = await range(stream);
    const inboxes: string[] = [];
    for await (const keys of probe.scanIterator({ MATCH: `${ks}:inbox:*`, COUNT: 100 })) inboxes.push(...keys);
    const inboxed = (await Promise.all(inboxes.map(range))).flat();
    const replies = published.filter((m) => m.at >= from);
    return {
      fetchSockets: entries.filter((e) => e.message.type === FETCH_SOCKETS).length,
      fetchReplies: replies.filter((m) => m.type === FETCH_SOCKETS_RESPONSE).length,
      serverSideEmits: [
        ...entries.filter((e) => e.message.type === SERVER_SIDE_EMIT).map((e) => e.message.data ?? ""),
        ...replies.filter((m) => m.type === Number(SERVER_SIDE_EMIT)).map((m) => m.text),
      ],
      texts: [...entries.map((e) => JSON.stringify(e.message)), ...inboxed.map((e) => JSON.stringify(e.message)), ...replies.map((m) => m.text)],
    };
  }

  before(async () => {
    // Creates the schema the child-process servers are then pointed at.
    const admin = new pg.Pool({ connectionString: baseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.end();
    await Promise.all([probe.connect(), tap.connect()]);
    await tap.pSubscribe(
      `${stream}#*`,
      (payload: Buffer) => {
        let decoded: unknown;
        try {
          decoded = decode(payload);
        } catch {
          decoded = null;
        }
        published.push({ at: Date.now(), text: JSON.stringify(decoded), type: (decoded as { type?: number } | null)?.type });
      },
      true
    );
    for (let n = 0; n < 2; n++) instances.push(await boot(scoped, { MURLAN_AFK_TIMEOUT_MS: "600000" }));
    PORTS.push(...instances.map((i) => i.port));
  });

  after(async () => {
    for (const s of sockets) s.close();
    for (const i of instances) await stopInstance(i.child);
    for (const c of [probe, tap]) c.destroy();
    try {
      await dropKeyspace(scoped);
      await dropSchema(baseUrl, schema);
    } finally {
      process.env.DATABASE_URL = baseUrl;
    }
  });

  test(`a connect with ${ON_B} sockets on the other instance sweeps nobody and sends no handshake`, async () => {
    const onB: { cookie: string; id: string }[] = [];
    // Registered through both instances at once: the password hash is the slow part.
    for (let i = 0; i < ON_B; i += 20) {
      onB.push(...(await Promise.all(Array.from({ length: 20 }, (_, j) => accountOn(PORTS[j % 2], `pb${tag}${i + j}`)))));
    }
    sockets.push(...(await Promise.all(onB.map((u) => connectTo(at(PORTS[1]), { cookie: u.cookie })))));
    const visitorName = `pa${tag}`;
    const visitor = await accountOn(PORTS[0], visitorName);
    await befriendOn(PORTS[0], onB[0]!, visitor, visitorName);

    const from = Date.now();
    const socket = await connectTo(at(PORTS[0]), { cookie: visitor.cookie });
    sockets.push(socket);
    const pushed = await waitFor(socket, "friend:online_list");
    assert.deepEqual(pushed.onlineIds, [onB[0]!.id], "the friend on the other instance read as offline");
    // An older bundle still asks on connect.
    const asked = waitFor(socket, "friend:online_list");
    socket.emit("friend:get_online_list", {});
    assert.deepEqual((await asked).onlineIds, [onB[0]!.id]);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const sent = await sentSince(from);
    assert.equal(sent.fetchSockets, 0, "a connect swept the cluster for its sockets");
    assert.equal(sent.fetchReplies, 0, "an instance answered a sweep");
    assert.deepEqual(sent.texts.filter((t) => HANDSHAKE.test(t)), [], "a message between instances carried a handshake");
    assert.equal(typeof pushed.social, "string", "the connect push carried no social version");
  });

  test("a revocation is one cluster message, and cuts the socket on the other instance", async () => {
    const name = `rv${tag}`;
    const account = await accountOn(PORTS[0], name);
    const socket = await connectTo(at(PORTS[1]), { cookie: account.cookie });
    sockets.push(socket);
    const cut = waitForOrNull(socket, "disconnect", 6_000);

    const from = Date.now();
    const out = await fetch(`${at(PORTS[0])}/api/auth/logout`, { method: "POST", headers: { cookie: account.cookie } });
    assert.equal(out.status, 200);
    assert.notEqual(await cut, null, "the socket on the other instance stayed live");

    const sent = await sentSince(from);
    const revocations = sent.serverSideEmits.filter((d) => d.includes("murlan:revoke-sockets"));
    assert.equal(revocations.length, 1, `revocation sent ${revocations.length} cluster messages`);
    assert.equal(sent.fetchSockets, 0);
    assert.deepEqual(sent.texts.filter((t) => HANDSHAKE.test(t)), [], "the revocation carried a session id or a handshake");
  });
});
