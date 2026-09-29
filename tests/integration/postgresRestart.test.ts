// tests/integration/postgresRestart.test.ts — every backend two servers hold is terminated at once,
// as a Postgres restart does: both must stay up, reconnect everything, and still shut down cleanly.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { io as ioClient, type Socket } from "socket.io-client";
import { PROTOCOL_AUTH, waitFor } from "../helpers/client.ts";
import { dropSchema, hasDatabase, scopedDatabaseUrl, skipMessage } from "../helpers/testServer.ts";
import { boot, type Instance } from "../helpers/instance.ts";
import { listenPattern } from "../../server/socket/socketAdapter.ts";
import { FORCED_EXIT_MS } from "../../server/http/shutdown.ts";

const PORTS = [5591, 5592] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function register(port: number, username: string): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "pg-restart-pw", email: `${username}@example.test` }),
  });
  const text = await res.text();
  assert.equal(res.status, 202, `register ${username} on ${port}: ${text}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

function connectSocket(port: number, cookie: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(`http://127.0.0.1:${port}`, {
      transports: ["websocket"],
      auth: PROTOCOL_AUTH,
      extraHeaders: { Cookie: cookie },
      reconnection: false,
    });
    s.once("connect", () => resolve(s));
    s.once("connect_error", reject);
  });
}

interface Watched {
  instance: Instance;
  output: string[];
  exit: { code: number | null; signal: string | null } | null;
}

function watch(instance: Instance): Watched {
  const w: Watched = { instance, output: [], exit: null };
  const keep = (buf: unknown) => {
    w.output.push(String(buf));
    if (w.output.length > 40) w.output.shift();
  };
  instance.child.stdout?.on("data", keep);
  instance.child.stderr?.on("data", keep);
  instance.child.once("exit", (code, signal) => (w.exit = { code, signal }));
  return w;
}

function assertAlive(w: Watched): void {
  assert.equal(
    w.exit,
    null,
    `instance on ${w.instance.port} exited ${JSON.stringify(w.exit)} after its Postgres backends ` +
      `were terminated. Last output:\n${w.output.join("").slice(-3000)}`
  );
}

describe("the server survives its Postgres backends being terminated", {
  skip: hasDatabase() ? false : skipMessage(),
}, () => {
  const schema = `pgrestart_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const baseUrl = process.env.DATABASE_URL!;
  const scoped = scopedDatabaseUrl(baseUrl, schema);
  const tag = Date.now().toString(36);
  const watched: Watched[] = [];
  const sockets: Socket[] = [];
  let admin: pg.Pool;
  let subscribed: number[] = [];
  let owner: number[] = [];
  let killed: number[] = [];

  async function pids(sql: string, params: unknown[] = []): Promise<number[]> {
    const { rows } = await admin.query<{ pid: number }>(sql, [schema, ...params]);
    return rows.map((r) => r.pid).sort();
  }

  const listenPids = () =>
    pids(
      `SELECT pid FROM pg_stat_activity WHERE application_name = $1 AND query LIKE $2 ESCAPE '\\'`,
      [listenPattern(scoped)]
    );

  const lockPids = () =>
    pids(
      `SELECT l.pid FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE a.application_name = $1 AND l.locktype = 'advisory' AND l.granted`
    );

  async function awaitPids(
    what: string,
    read: () => Promise<number[]>,
    count: number,
    excluding: number[],
    ms: number
  ): Promise<number[]> {
    const deadline = Date.now() + ms;
    for (;;) {
      watched.forEach(assertAlive);
      const found = (await read()).filter((p) => !excluding.includes(p));
      if (found.length === count) return found;
      assert.ok(Date.now() < deadline, `${found.length} of ${count} ${what} after ${ms} ms`);
      await sleep(100);
    }
  }

  async function join(port: number, username: string): Promise<Socket> {
    const socket = await connectSocket(port, await register(port, username));
    sockets.push(socket);
    return socket;
  }

  before(async () => {
    admin = new pg.Pool({ connectionString: baseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    for (const port of PORTS) {
      const instance = await boot(port, scoped, {
        MURLAN_SOCKET_ADAPTER_POOL_MAX: "2",
        MURLAN_AFK_TIMEOUT_MS: "600000",
      });
      watched.push(watch(instance));
    }
  });

  after(async () => {
    for (const s of sockets) s.close();
    for (const w of watched) w.instance.child.kill("SIGKILL");
    await admin?.end();
    await dropSchema(baseUrl, schema);
  });

  test("both instances subscribe", async () => {
    subscribed = await awaitPids("instances subscribed", listenPids, PORTS.length, [], 10_000);
  });

  test("a game dealt across the instances claims its room", { timeout: 90_000 }, async () => {
    const host = await join(PORTS[0], `pa${tag}`);
    const guest = await join(PORTS[1], `pb${tag}`);
    const created = waitFor<{ code: string }>(host, "room:state");
    host.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
    const room = await created;
    const seated = waitFor(host, "room:state");
    guest.emit("room:join", { code: room.code });
    await seated;
    const dealt = waitFor(guest, "game:state", 10_000);
    host.emit("room:start");
    await dealt;
    owner = await awaitPids("room locks held", lockPids, 1, [], 5_000);
  });

  test("terminating every backend kills neither instance, and both subscribe again", async () => {
    const { rows } = await admin.query<{ pid: number; ok: boolean }>(
      "SELECT pid, pg_terminate_backend(pid) AS ok FROM pg_stat_activity WHERE application_name = $1",
      [schema]
    );
    killed = rows.filter((r) => r.ok).map((r) => r.pid);
    for (const pid of [...subscribed, ...owner]) {
      assert.ok(killed.includes(pid), `backend ${pid} was not terminated`);
    }
    assert.ok(
      killed.length >= 2 * PORTS.length + 1,
      `only ${killed.length} backends terminated: each instance's LISTEN and app-pool client, and the lock holder, should be among them`
    );
    await awaitPids("instances subscribed again", listenPids, PORTS.length, killed, 10_000);
    await sleep(500);
    watched.forEach(assertAlive);
  });

  test("the ownership connection comes back and takes its room's lock again", async () => {
    await awaitPids("room locks taken again", lockPids, 1, killed, 10_000);
  });

  test("each instance holds exactly one adapter client checked out", async () => {
    const deadline = Date.now() + 5_000;
    for (const port of PORTS) {
      let checkedOut = -1;
      for (;;) {
        const res = await fetch(`http://127.0.0.1:${port}/health`);
        const body = (await res.json()) as { db: string; adapterPool: { total: number; idle: number } };
        assert.equal(res.status, 200, `/health on ${port}: ${JSON.stringify(body)}`);
        assert.equal(body.db, "connected");
        checkedOut = body.adapterPool.total - body.adapterPool.idle;
        if (checkedOut === 1 || Date.now() > deadline) break;
        await sleep(200);
      }
      assert.equal(
        checkedOut,
        1,
        `instance ${port} holds ${checkedOut} adapter clients checked out — the dead LISTEN client was never released`
      );
    }
  });

  test("a room made after the restart still reaches the other instance", { timeout: 60_000 }, async () => {
    const host = await join(PORTS[0], `pc${tag}`);
    const guest = await join(PORTS[1], `pd${tag}`);
    const created = waitFor<{ code: string }>(host, "room:state");
    host.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
    const room = await created;
    const heard = waitFor<{ players: unknown[] }>(host, "room:state", 5_000);
    guest.emit("room:join", { code: room.code });
    assert.equal((await heard).players.length, 2, "the join on the other instance never reached the host");
    watched.forEach(assertAlive);
  });

  test(
    "SIGTERM after the restart shuts down cleanly",
    { skip: process.platform === "win32" && "Windows has no SIGTERM: kill() ends the process outright" },
    async () => {
      const w = watched[1];
      let log = "";
      w.instance.child.stdout?.on("data", (buf) => (log += String(buf)));
      w.instance.child.stderr?.on("data", (buf) => (log += String(buf)));
      const exited = new Promise((resolve) => w.instance.child.once("exit", resolve));
      w.instance.child.kill("SIGTERM");
      await Promise.race([exited, sleep(FORCED_EXIT_MS + 3_000)]);
      assert.match(log, /Graceful shutdown initiated/, `no shutdown line, so this output is not the server's:\n${log.slice(-3000)}`);
      assert.deepEqual(w.exit, { code: 0, signal: null }, `exited ${JSON.stringify(w.exit)}:\n${log.slice(-3000)}`);
      assert.doesNotMatch(log, /Forced shutdown/);
    }
  );
});
