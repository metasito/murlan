// tests/integration/redisBlackhole.test.ts — a half-open Redis link is found and replaced.
//
// Instance A reaches Redis through a proxy that can stop every open connection dead while TCP
// still holds it: nothing is refused, nothing errors, and every reply simply never comes. A must
// notice on its own, open new connections, and hear instance B again.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { connectSocket, eventually, waitFor, type TestSocket } from "../helpers/client.ts";
import { dropSchema, hasDatabase, scopedDatabaseUrl, skipMessage } from "../helpers/testServer.ts";
import { boot, freePorts, type Instance } from "../helpers/instance.ts";
import { dropKeyspace } from "../helpers/redisKeys.ts";
import { startProxy, targetOf, viaProxy, type Proxy } from "../helpers/tcpProxy.ts";

const REPLACED_WITHIN_MS = 15_000;

async function register(port: number, username: string): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "blackhole-pw", email: `${username}@example.test` }),
  });
  assert.equal(res.status, 202, await res.text());
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

describe("a half-open Redis link", { skip: hasDatabase() ? false : skipMessage() }, () => {
  const schema = `rbh_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const baseUrl = process.env.DATABASE_URL!;
  const scoped = scopedDatabaseUrl(baseUrl, schema);
  const instances: Instance[] = [];
  const sockets: TestSocket[] = [];
  let proxy: Proxy;
  let ports: number[];

  before(async () => {
    const admin = new pg.Pool({ connectionString: baseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.end();
    proxy = await startProxy(targetOf(process.env.REDIS_URL!, 6379));
    ports = await freePorts(2);
    const env = { MURLAN_AFK_TIMEOUT_MS: "600000" };
    instances.push(await boot(ports[0], scoped, { ...env, REDIS_URL: viaProxy(process.env.REDIS_URL!, proxy) }));
    instances.push(await boot(ports[1], scoped, env));
  });

  after(async () => {
    for (const s of sockets) s.close();
    for (const i of instances) i.child.kill("SIGKILL");
    await proxy?.close();
    await dropKeyspace(scoped);
    await dropSchema(baseUrl, schema);
  });

  test("is replaced within 15 s, and the other instance's broadcast reaches it again", { timeout: 60_000 }, async () => {
    const tag = Date.now().toString(36);
    const onA = await connectSocket(`http://127.0.0.1:${ports[0]}`, { cookie: await register(ports[0], `ba${tag}`) });
    const onB = await connectSocket(`http://127.0.0.1:${ports[1]}`, { cookie: await register(ports[1], `bb${tag}`) });
    sockets.push(onA, onB);

    const live = proxy.links.filter((l) => !l.dead).length;
    assert.ok(live >= 5, `A holds ${live} Redis connections; its adapter and inbox need five`);
    const opened = proxy.links.length;
    const started = Date.now();
    assert.equal(proxy.blackholeExisting(), live);

    await eventually(
      () => proxy.links.length - opened >= live,
      `A to replace all ${live} stalled connections`,
      REPLACED_WITHIN_MS
    );
    const replacedMs = Date.now() - started;
    assert.ok(replacedMs < REPLACED_WITHIN_MS, `A took ${replacedMs} ms to replace its connections`);

    const created = waitFor(onB, "room:state");
    onB.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
    const room = await created;
    const heard = waitFor(onB, "room:state", Math.max(1_000, REPLACED_WITHIN_MS - (Date.now() - started)));
    const told = waitFor(onA, "room:state", Math.max(1_000, REPLACED_WITHIN_MS - (Date.now() - started)));
    onA.emit("room:join", { code: room.code });
    assert.equal((await heard).players.length, 2, "B never heard A's join");
    assert.equal((await told).players.length, 2, "A never heard B's room broadcast");
    assert.equal(instances[0].child.exitCode, null, "A exited");
  });
});
