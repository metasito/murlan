# The server survives Postgres restarting: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Seam errata (final cross-plan check).** If plan 4 has landed, its `nativeScope.mjs` patch pattern must not match `patches/@socket.io+postgres-adapter+*.patch`. Check that it doesn't; a server-only patch must not trigger the native compiles.

**Goal:** A Postgres restart, or a terminated backend, no longer kills the server, and cross-instance broadcasts recover afterwards without anyone restarting it.

**Architecture:** `server/store/pool.ts` becomes the only module that opens a Postgres connection, and the only one that reads `DATABASE_URL` to do it. `createPool(name, config)` puts an `error` listener on the pool and on every client it connects, and `createClient(config, onError)` requires one. `@socket.io/postgres-adapter` re-subscribes by itself but never releases a `LISTEN` client it loses, and can schedule two reconnections at once. A patch-package patch to its `dist/util.js` fixes all three paths at the source, and the upstream PR text is drafted for the owner. A source scan with a planted floor and a two-instance integration test guard the class.

**Tech Stack:** Node 22 (`node --test`, type-stripped `.ts`), `pg` 8.23 / `pg-pool` 3.14, `@socket.io/postgres-adapter` 0.5.0, patch-package 8.0.1 (`postinstall`), `socket.io-client`, Postgres from `scripts/dev-stack.mjs`.

**Spec:** `docs/plans/2026-09-28-1259-design.md` §7; the finding is in `docs/research/2026-09-28-lantern-review.md` § "Other defects found on the way" (first bullet). The dead client is released inside the adapter patch, not from `socketAdapter.ts`, because the patch must also release in its `catch`, and two owners of one release throw: `pg-pool`'s `_releaseOnce` refuses a second release (`pg-pool/index.js:27`).

## Coverage

| Finding | Task |
| --- | --- |
| Server crashes when Postgres restarts: the adapter's `LISTEN` client has no `error` listener (`socketAdapter.ts:162` only covers idle clients) | 1 (red test), 2 (listener on every client), 3 (the adapter's dead client is released, so broadcasts recover) |
| `db.ts:63` sibling: a client checked out by `db.transaction` between two queries has no `error` listener either | 2 |
| The adapter leaks one pool slot per dead `LISTEN` client (found while verifying; not in the research) | 3 (patch), 1 (`/health` per instance) |
| The adapter leaks a slot when `LISTEN` fails on a live connection, and a backend dying mid-`LISTEN` schedules two reconnections (orphan `LISTEN` client, every broadcast delivered twice, a timer `close()` cannot clear) | 3 (patch, one test per path) |
| Shutdown after a restart: `adapterPool.end()` (`shutdown.ts:88-91`) waits on the dead client until the forced exit | 3 (patch), 1 (SIGTERM after the restart exits 0) |
| The ownership connection's drop → reclaim after its backend dies | 1 (a claimed room's advisory lock is taken again by a new backend) |
| Nothing stops a fourth unguarded connection: `new Pool(`, `drizzle(url)`, a re-export, a dynamic `import`/`require`, `pg-pool` | 2 (scan with a planted floor) |
| Docs naming the changed files and the new invariant | 4 |

## What the source says (verified 2026-09-28, against the installed packages)

- **The crash is real.** `pg_terminate_backend` makes the backend send `FATAL 57P01 terminating connection due to administrator command`. `pg/lib/client.js` `_handleErrorMessage` finds no active query on an idle `LISTEN` client and calls `_handleErrorEvent`, which runs `this.emit('error', err)`. `pg-pool` only attaches its `idleListener` while a client is idle, and `_acquireClient` removes it at checkout (`pg-pool/index.js:344`). The adapter's `initClient` (`@socket.io/postgres-adapter/dist/util.js:62-101`) adds only `notification` and `end` listeners. With no `error` listener the emit throws, `installProcessGuards` (`server/socket/socketSafety.ts:272`) catches it as `uncaughtException`, and the process calls `process.exit(1)`.
- **The adapter already reconnects.** When a client emits `end`, `util.js:86-90` sets `this.client = undefined` and schedules `initClient` again after 1–3 s. That re-runs `LISTEN` for every channel in `this.channels`. No resubscription code is needed.
- **The adapter never releases the dead client.** `close()` releases only `this.client`, and the `end` handler has already cleared it. `pg-pool` attaches no `end` listener of its own except for `maxLifetimeSeconds` (`pg-pool/index.js:328`), so the dead client stays in `pool._clients` and each restart permanently costs one slot. With the test harness's `MURLAN_SOCKET_ADAPTER_POOL_MAX=2`, one restart leaves the dead client plus the new `LISTEN` client, the pool is full, and every `pg_notify` waits out `connectionTimeoutMillis` before the adapter's `errorHandler` swallows it. Production's 4 starves after three restarts. `pool.end()` at shutdown (`server/http/shutdown.ts:88-91`) also waits for the release until `FORCED_EXIT_MS` exits 1.
- **The adapter has two more leak paths (`util.js:86-100`).** If `LISTEN` fails on a live connection, the `catch` reschedules without releasing the client. If the backend dies while `LISTEN` is in flight, `pg` both rejects the query and emits `end` (`pg/lib/client.js:203-228`; on a bare socket close the `end` handler runs first), so the `end` handler and the `catch` both call `scheduleReconnection()`. Two `initClient` runs then each take a `LISTEN` client, the first is overwritten in `this.client` but keeps delivering notifications (every broadcast twice), and `close()` can clear only the second timer. The four tests in Task 3 were run on 2026-09-28 against the installed 0.5.0 (all four red, each with its own message) and against the patched copy (all four green).
- **`db.ts` is the same class, through transactions.** `drizzle-orm/node-postgres/session.js:180-195` holds a `pool.connect()` client across the awaits of a `db.transaction`. There are 14 such call sites, in `server/game/` (2), `server/http/` (2), `server/socket/` (1) and `server/store/` (9). `pool.query` is safe on its own because it attaches `client.once('error', onError)` for the duration (`pg-pool/index.js:454-466`).
- **There is a third connection.** `server/game/gameOwnership.ts:80` does `new Client(...)` for the advisory locks. It already registers `error` and reconnects through `drop()` → `reclaim()`, so it is correct today. It moves behind `createClient` so that one file owns the URL and the scan has one allowed file. An error while connecting never reaches that listener: `connect()` always passes a callback, and `_handleErrorWhileConnecting` hands the error to it (`pg/lib/client.js:156`, `:400-410`).
- **A second connection needs only the URL.** `drizzle(process.env.DATABASE_URL)` and `drizzle({ connection })` build a `pg.Pool` with no `error` listener (`drizzle-orm/node-postgres/driver.js:61-71`), and connect-pg-simple does the same from `conString`. So the scan forbids the URL itself, not just `new Pool(`.
- **A checked-out client may be released only once.** `pg-pool`'s `_releaseOnce` throws on a second release. The patch keeps one `released` flag per `LISTEN` client for its `end` handler and its `catch`, and `close()` removes the `end` listener before its own release. `createPool` releases nothing. A drizzle transaction releases its own client in its `finally`.
- **The worktree has no `node_modules`, and needs none.** It sits under the main checkout, so Node, `npx tsc` and `npx eslint` resolve packages from `C:/Users/roton/murlan/node_modules` by walking up the parent directories (checked 2026-09-28: `require.resolve('pg')` from the worktree). `docs/agents/checks.md` § "Remaining traps" forbids hand-making a `node_modules` junction, because `node --test` then fails every file with `Cannot find package 'typescript'`.

## Global Constraints

- One module opens connections. Under `server/`, only `server/store/pool.ts` may import `pg` or `pg-pool` at runtime (`import`, `export … from`, `import(…)`, `require(…)`), construct a `Pool` or `Client`, hand `drizzle(` a URL or a config, or name `connectionString`, `conString` or `DATABASE_URL`. `import type` is allowed anywhere. The only other `DATABASE_URL` reads are pinned by count in the scan, each with its reason: `server/http/bootEnv.ts` checks the variable at boot, and `server/socket/socketAdapter.ts` passes it to `channelPrefix`/`listenPattern`, which return strings. `scripts/` and `tests/` are out of scope: they are one-shot processes, not the server.
- The adapter fix is `patches/@socket.io+postgres-adapter+0.5.0.patch`, applied by the existing `"postinstall": "patch-package"`. Never apply it to the shared install (`C:/Users/roton/murlan/node_modules`): every other session runs on it, and a change there is invisible to git. So locally its tests stay red, and they go green on CI, whose `npm ci` runs the `postinstall`.
- Integration tests pin their own ports, and `tests/tooling/integrationPorts.test.ts` refuses a shared one. This plan takes **5591, 5592**.
- Integration tests need `DATABASE_URL` from `node scripts/dev-stack.mjs env`. Without it they skip silently, so a green run with zero tests executed proves nothing.
- Locally, run only `node --test <one file>`, `npx tsc --noEmit` and `npx eslint <files>` (rules 1–4). Whole suites, `npm run check:comments` included, run on CI.
- Comment budget (`CLAUDE.md` § Comments): a change fails when it adds more than six comment lines (three in a test) *and* more comment lines than code. That is counted against `origin/main` over the whole branch. Each code block below is inside it, so do not add prose to them.
- Stage by pathspec: `git add -- <files>`, never `-A` (rule 11). Change files with Edit/Write, never `sed` (rule 44).
- Never terminate backends by database. CI runs integration files in parallel against one database, so terminate by `application_name = <schema>`, which `scopedDatabaseUrl` sets on every connection a scoped server opens.

## Review Focus

1. **Postgres down for seconds, not a terminated backend** (a real restart): connections are refused for a while. Expected: every reconnect attempt fails quietly and the adapter keeps retrying every 1–3 s until one succeeds. `pool.connect` failures come back through the connect callback (`pg-pool/index.js:271-284`), not as emitted errors, and the patched `catch` then has no client to release. No test restarts the shared container, because that would break every peer file. Reviewers read the patch's `catch` with that in mind.
2. **Repeated restarts:** every restart must free the slot it took, or the leak compounds. Task 3's third test ends the `LISTEN` client twice in a row and asserts nothing is left checked out each time. Task 1 asserts one checked-out adapter client per instance after a real termination.
3. **Shutdown after a restart:** `adapterPool.end()` must resolve. Task 3's third test ends the pool after two rounds. Task 1's last test sends a real SIGTERM after the termination and asserts exit code 0 inside `FORCED_EXIT_MS`. That test runs on Linux only, so on this machine it is read on CI.
4. **One `LISTEN` client handed back twice:** `pg-pool` throws on the second release. The patch's per-client `released` flag covers the `end`-then-`catch` order, and a late `end` from a client the pool is already removing returns early. `close()` removes the `end` listener before it releases. Task 3's fake client emits `end` from `end()`, as `pg` does, so the tests cross that path.
5. **A transaction whose backend dies between two statements:** the client-level listener keeps the process alive, the transaction rejects, and drizzle's own `release()` removes the non-queryable client. Task 2's unit test covers the listener on a checked-out client. Reviewers confirm `createPool` never releases anything itself.
6. **`close()` racing `initClient`:** if the adapter closes while a reconnection is checking out or running `LISTEN`, the patched `initClient` releases that client instead of installing it, and `scheduleReconnection` does nothing once closed.

Broadcasts published in the 1–3 s before the adapter re-subscribes are lost. The adapter cannot hear them, and this plan does not change that: game state is re-sent until acknowledged (`MURLAN_STATE_ACK_TIMEOUT_MS`, `tests/integration/stateRedelivered.test.ts`). The integration test broadcasts only after it has seen both new `LISTEN` backends.

---

### Task 1: The failing integration test: terminate every backend, the servers stay up

**Files:**
- Create: `tests/integration/postgresRestart.test.ts`

**Interfaces:**
- Consumes: `boot(port, databaseUrl, env)` from `tests/helpers/instance.ts`; `dropSchema`, `hasDatabase`, `scopedDatabaseUrl`, `skipMessage` from `tests/helpers/testServer.ts`; `PROTOCOL_AUTH`, `waitFor` from `tests/helpers/client.ts`; `listenPattern(databaseUrl)` from `server/socket/socketAdapter.ts`; `FORCED_EXIT_MS` from `server/http/shutdown.ts`; `GET /health` (`server/app.ts:226`), which runs `pool.query("SELECT 1")` on the app pool and returns `adapterPool: { total, idle, waiting, … }`; the socket events `room:create`, `room:join`, `room:start`, `room:state`, `game:state`.
- Produces: nothing that other tasks import. Tasks 2 and 3 rerun this file.

The file is seven tests in one `describe`, run in order against the same two servers. After the termination, every wait on Postgres or `/health` is a real deadline of at most 10 s, never scaled, and the SIGTERM wait is `FORCED_EXIT_MS` + 3 s. So a slow reconnect fails with its own message well inside `--test-timeout=30000` (`package.json:36`). The two tests built on `waitFor` carry their own `timeout`, because `waitFor` multiplies its deadline by `SLOW_RUNNER_SCALE` (4) on CI (`tests/helpers/client.ts:199-211`).

- [ ] **Step 1: Check that the worktree resolves the shared install (Git Bash)**

```bash
node -e "console.log(require.resolve('pg'))" && npx --no-install tsc --version
```

Expected: a path under `C:\Users\roton\murlan\node_modules\pg\` and a TypeScript version. The worktree has no `node_modules` of its own and must not get one (see "What the source says"). If either command fails, stop and report it; do not create a link.

- [ ] **Step 2: Bring up Postgres and export its URL (pwsh)**

```powershell
node scripts/dev-stack.mjs up
$env:DATABASE_URL = ((node scripts/dev-stack.mjs env) -match '^DATABASE_URL=' -replace '^DATABASE_URL=', '')
```

Check that `$env:DATABASE_URL` is non-empty. An empty value makes every step below skip, and a skip reads as green.

- [ ] **Step 3: Write the test**

```ts
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
```

- Both `register` calls in the sixth test run after the termination, so they are the queries through `db`: a drizzle insert, plus the session row through connect-pg-simple on the same pool. `/health` is the raw `pool.query`.
- The floor in the third test counts what must exist at that moment: two `LISTEN` clients, an app-pool client on each instance (both served queries within the last 30 s, `idleTimeoutMillis`), and the ownership connection that holds the dealt room's lock. The adapter's idle publishers (never reaped, `idleTimeoutMillis: 0`) come on top.
- The fourth test covers the ownership client's path: its `error` listener calls `drop()`, `reclaim()` reconnects, and a backend that was not killed holds the lock again.
- The seventh test asserts the exit code. `Forced shutdown after timeout` is logged just before `exit(1)` and may not reach the pipe, so its absence is only a second check. `Graceful shutdown initiated` is the floor that proves the log is being read at all.

- [ ] **Step 4: Run it and watch it fail for the reason claimed**

Run: `node --test tests/integration/postgresRestart.test.ts`

Expected: the first two tests PASS. The third FAILS from `assertAlive` inside `awaitPids`, with a message like `instance on 5591 exited {"code":1,"signal":null} after its Postgres backends were terminated`. The output tail should contain `Uncaught exception — exiting` and `terminating connection due to administrator command`. Code 1 with no signal is `installProcessGuards`' `process.exit(1)`. The later tests fail too, because both servers are gone. On Windows the seventh is skipped. Read the third test's message only.

Read the message, not the exit status (rule 6). If the first test fails with `0 of 2 instances subscribed`, the pattern or `application_name` is wrong, and the test is not reaching the defect yet. If the second fails with `0 of 1 room locks held`, the lock query is wrong. If the third fails on its floor instead, the termination missed a class of client. If the output tail is empty, pino's pretty transport did not flush before the exit. Confirm the cause by rerunning with `$env:DEBUG = "socket.io-postgres-adapter"` and checking that the adapter logged `client acquired` just before the exit.

- [ ] **Step 5: Check the port pin and the file itself**

Run: `node --test tests/tooling/integrationPorts.test.ts` → PASS.
Run: `npx eslint tests/integration/postgresRestart.test.ts` → no errors.

- [ ] **Step 6: Commit (red on purpose; the branch is not pushed until Task 4)**

```powershell
git add -- tests/integration/postgresRestart.test.ts
git commit -m "test: terminating every Postgres backend must not kill the server

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: One module opens every connection, and every client has an `error` listener

**Files:**
- Create: `server/store/pool.ts`
- Create: `tests/server/pool.test.ts`
- Create: `tests/server/pgConnections.test.ts`
- Modify: `server/store/db.ts:2` (import), `:48-63` (construction, and the removed listener and its comment)
- Modify: `server/socket/socketAdapter.ts:1` (import), `:151-162` (construction, and the removed listener)
- Modify: `server/game/gameOwnership.ts:13` (import), `:80-90` (construction)

**Interfaces:**
- Produces: `createPool(name: string, config: Omit<PoolConfig, "connectionString">): Pool` and `createClient(config: Omit<ClientConfig, "connectionString">, onError: (err: Error) => void): Client`, both from `server/store/pool.ts`. Each reads `process.env.DATABASE_URL` itself, per call, so no caller names the URL. The socket adapter's pool reaches Task 3's patch through `createSocketAdapter`.

- [ ] **Step 1: Create `server/store/pool.ts` with today's behaviour only (pool-level listener)**

```ts
import { Client, Pool, type ClientConfig, type PoolConfig } from "pg";
import { logger } from "../http/logger.ts";

export function createPool(name: string, config: Omit<PoolConfig, "connectionString">): Pool {
  const pool = new Pool({ ...config, connectionString: process.env.DATABASE_URL });
  pool.on("error", (err) => logger.error({ err, pool: name }, "Idle Postgres client error"));
  return pool;
}

export function createClient(
  config: Omit<ClientConfig, "connectionString">,
  onError: (err: Error) => void
): Client {
  const client = new Client({ ...config, connectionString: process.env.DATABASE_URL });
  client.on("error", onError);
  return client;
}
```

- [ ] **Step 2: Write the unit test**

```ts
// tests/server/pool.test.ts — pg emits `error` on a checked-out client when its backend dies, and
// an `error` event nobody listens for exits the process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createClient, createPool } from "../../server/store/pool.ts";

class FakeClient extends EventEmitter {
  _queryable = true;
  connection = { stream: { unref() {}, ref() {} } };
  connect(cb: (err?: Error) => void) {
    setImmediate(() => cb());
  }
  end(cb?: () => void) {
    cb?.();
    return Promise.resolve();
  }
  ref() {}
  unref() {}
}

const terminated = () => new Error("terminating connection due to administrator command");

test("a checked-out client's error is handled, not thrown", async () => {
  const pool = createPool("test", { Client: FakeClient as never, max: 1 });
  const client = await pool.connect();
  assert.equal(client.listenerCount("error"), 1, "createPool left the checked-out client with no error listener");
  assert.doesNotThrow(() => client.emit("error", terminated()));
  client.release(terminated());
  await pool.end();
});

test("an idle client's error is handled, not thrown", async () => {
  const pool = createPool("test", { Client: FakeClient as never, max: 1 });
  const client = await pool.connect();
  client.release();
  assert.equal(pool.idleCount, 1, "the fake client was not returned idle, so this tests nothing");
  assert.doesNotThrow(() => client.emit("error", terminated()));
  assert.equal(pool.totalCount, 0, "the pool kept a client whose backend died");
  await pool.end();
});

test("createClient hands every error to the caller's handler", () => {
  const seen: Error[] = [];
  const client = createClient({}, (err) => seen.push(err));
  assert.doesNotThrow(() => client.emit("error", terminated()));
  assert.equal(seen.length, 1);
});
```

- [ ] **Step 3: Run it and watch the first test fail for the reason claimed**

Run: `node --test tests/server/pool.test.ts`
Expected: the first test FAILS with `createPool left the checked-out client with no error listener` and `0 !== 1`. The other two PASS. If the first test instead fails by throwing `terminating connection…`, the `listenerCount` assertion was removed. Put it back, because that assertion is the intermediate state.

- [ ] **Step 4: Add the per-client listener**

Replace the body of `createPool` in `server/store/pool.ts`:

```ts
export function createPool(name: string, config: Omit<PoolConfig, "connectionString">): Pool {
  const pool = new Pool({ ...config, connectionString: process.env.DATABASE_URL });
  // Every client error is logged below; this only absorbs pg-pool's re-emit for an idle one.
  pool.on("error", () => {});
  // pg-pool listens on a client only while it is idle: a backend dying under a checked-out one
  // (a transaction between statements, the socket adapter's LISTEN) emits with nobody listening.
  pool.on("connect", (client) => {
    client.on("error", (err) => logger.error({ err, pool: name }, "Postgres client error"));
  });
  return pool;
}
```

- [ ] **Step 5: Run the unit test green**

Run: `node --test tests/server/pool.test.ts` → 3 PASS.

- [ ] **Step 6: Write the scan, with its planted floor**

```ts
// tests/server/pgConnections.test.ts — every Postgres connection the server opens goes through
// server/store/pool.ts, which is what gives each client an `error` listener.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blankComments, scanSources, sourcesUnder } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FACTORY = "server/store/pool.ts";
const PG = String.raw`["']pg(?:-pool)?["']`;
const CONNECTION = new RegExp(
  [
    String.raw`\bnew\s+(?:pg\.)?(?:Pool|Client)\s*\(`,
    String.raw`\b(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s*${PG}`,
    String.raw`\b(?:import|require)\s*\(\s*${PG}`,
    String.raw`\bdrizzle\s*\(\s*(?:["'\x60{]|process\b)`,
    String.raw`\b(?:connectionString|conString|DATABASE_URL)\b`,
  ].join("|"),
  "g"
);
const READS_URL: Record<string, { reads: number; why: string }> = {
  "server/http/bootEnv.ts": { reads: 3, why: "checks the variable at boot, and names it in two messages" },
  "server/socket/socketAdapter.ts": { reads: 2, why: "hands it to channelPrefix and listenPattern, which return strings" },
};

function connectionSites(sources: [string, string][]): string[] {
  return scanSources(CONNECTION, sources.map(([file, src]): [string, string] => [file, blankComments(src)]));
}

test("only server/store/pool.ts opens a Postgres connection or reads the URL to open one", () => {
  const sites = connectionSites(sourcesUnder(repoRoot, ["server"], /\.[cm]?[jt]sx?$/));
  assert.ok(sites.some((s) => s.startsWith(`${FACTORY}:`)), `nothing found in ${FACTORY}: the scan reads nothing`);
  const allowed = Object.entries(READS_URL).flatMap(([file, { reads }]) =>
    Array.from({ length: reads }, () => `${file}: DATABASE_URL`)
  );
  assert.deepEqual(sites.filter((s) => !s.startsWith(`${FACTORY}:`)), allowed.sort());
});

test("the scan sees every way a connection is written, and not a type import or a comment", () => {
  const planted: [string, string][] = [
    ["server/a.ts", "const p = new Pool({});"],
    ["server/b.ts", "const p = new pg.Pool({});"],
    ["server/c.ts", "const c = new Client({});"],
    ["server/d.ts", 'import { Pool as P } from "pg";'],
    ["server/e.ts", 'import pg from "pg";'],
    ["server/f.ts", 'export { Pool } from "pg";'],
    ["server/g.ts", 'const { Pool } = await import("pg");'],
    ["server/h.ts", 'const pg = require("pg");'],
    ["server/i.ts", 'import Pool from "pg-pool";'],
    ["server/j.ts", "export const db = drizzle(process.env.DATABASE_URL);"],
    ["server/k.ts", "export const db = drizzle({ connection: url });"],
    ["server/l.ts", "const store = new PgStore({ conString: url });"],
    [
      "server/m.ts",
      'import type { Pool } from "pg";\n// new Pool({})\nimport x from "connect-pg-simple";\nconst db = drizzle(pool, { schema });',
    ],
  ];
  assert.deepEqual(
    [...new Set(connectionSites(planted).map((s) => s.split(":")[0]))],
    ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"].map((f) => `server/${f}.ts`)
  );
});
```

- [ ] **Step 7: Run the scan and watch it fail on the three real sites**

Run: `node --test tests/server/pgConnections.test.ts`
Expected: the second test PASSES. The first FAILS with a `deepEqual` diff whose extra entries are exactly the unmigrated sites: `server/game/gameOwnership.ts`, `server/socket/socketAdapter.ts` and `server/store/db.ts`, four each: `import { … } from "pg"`, `new Pool(` or `new Client(`, `connectionString`, and `DATABASE_URL` (a third one, for `socketAdapter.ts`). That is 12 extra entries, checked against the current tree on 2026-09-28. This red is the scan's planted floor on real code (rule 6). If `db.ts` is missing from the list, the pattern is wrong. If a `bootEnv.ts` entry is missing or extra, recount its `DATABASE_URL`s against `READS_URL` before touching the pattern.

- [ ] **Step 8: Migrate `server/store/db.ts`**

Replace line 2 `import { Pool } from "pg";` with the line below, and delete line 4 (`import { logger } …`), whose only use was line 63:

```ts
import { createPool } from "./pool.ts";
```

Replace lines 48–63 (the `new Pool({...})` through the `pool.on("error", …)` line and its three-line comment) with:

```ts
export const pool = createPool("app", {
  max: POOL_MAX,
  // Every bound here is a failure mode with a deadline rather than a hang:
  // without them a caller waits forever for a free client, and a single stuck
  // backend query holds one of the ten slots for as long as it likes.
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  statement_timeout: QUERY_TIMEOUT_MS,
  query_timeout: QUERY_TIMEOUT_MS,
});
```

- [ ] **Step 9: Migrate `server/socket/socketAdapter.ts`**

Replace line 1 `import { Pool } from "pg";` with:

```ts
import type { Pool } from "pg";
import { createPool } from "../store/pool.ts";
```

In `createSocketAdapter`, replace `const pool = new Pool({` with `const pool = createPool("socket-adapter", {`, delete the `connectionString: process.env.DATABASE_URL,` line under it (152), and delete line 162:

```ts
  pool.on("error", (err) => logger.error({ err }, "Idle Postgres client error (socket adapter)"));
```

- [ ] **Step 10: Migrate `server/game/gameOwnership.ts`**

Replace line 13 `import { Client } from "pg";` with:

```ts
import type { Client } from "pg";
import { createClient } from "../store/pool.ts";
```

Replace lines 80–90 (the `new Client({...})`, the two-line comment, and `next.on("error", …)`) with:

```ts
    const next = createClient(
      {
        query_timeout: OWNERSHIP_QUERY_TIMEOUT_MS,
        statement_timeout: OWNERSHIP_QUERY_TIMEOUT_MS,
      },
      (err) => {
        logger.error({ err }, "Game ownership connection failed — every claimed room is now unowned");
        drop(next);
      }
    );
```

- [ ] **Step 11: Verify**

Run each:
- `node --test tests/server/pgConnections.test.ts` → 2 PASS
- `node --test tests/server/pool.test.ts tests/server/poolConfig.test.ts tests/server/socketAdapter.test.ts tests/server/tableOwnership.test.ts` → PASS
- `npx tsc --noEmit` → no errors
- `npx eslint server/store/pool.ts server/store/db.ts server/socket/socketAdapter.ts server/game/gameOwnership.ts tests/server/pool.test.ts tests/server/pgConnections.test.ts` → no errors
- `node --test tests/integration/postgresRestart.test.ts` (with `DATABASE_URL` set) → **still FAILS, but later and differently**: tests 1–4 PASS, so both instances stay alive, re-subscribe, and the ownership connection takes its lock again. Test 5 fails with `instance 5591 holds 2 adapter clients checked out — the dead LISTEN client was never released`. Test 6 fails with `timed out waiting for "room:state"`, because the adapter pool of 2 is full and the `pg_notify` is swallowed. On Windows, test 7 is skipped. That is Task 3's defect. If test 5 passes instead, the leak assertion is not reading `/health`'s `adapterPool`, so fix the test before going on.

- [ ] **Step 12: Commit**

```powershell
git add -- server/store/pool.ts server/store/db.ts server/socket/socketAdapter.ts server/game/gameOwnership.ts tests/server/pool.test.ts tests/server/pgConnections.test.ts
git commit -m "fix: one module opens every Postgres connection, and every client has an error listener

A backend terminated under a checked-out client, such as the socket adapter's
LISTEN client or a transaction between statements, emitted 'error' with no
listener and exited the process.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The adapter hands back every `LISTEN` client it loses, and reconnects once (patch-package)

**Files:**
- Create: `patches/@socket.io+postgres-adapter+0.5.0.patch`
- Create: `tests/server/postgresAdapterPatch.test.ts`

**Interfaces:**
- Consumes: `PubSubClient` from `@socket.io/postgres-adapter/dist/util.js` (0.5.0, no `exports` map, so the subpath resolves, and `dist/util.d.ts` types it): `new PubSubClient(pool, opts, isFromSelf, onMessage)`, `addNamespace(nsp)`, `close()`. The existing `"postinstall": "patch-package"` (`package.json:9`, patch-package 8.0.1, which exits 1 on CI when a patch fails to apply). The repo's last patch, `patches/expo-asset+12.0.13.patch`, was removed in `9654cc13`, so this recreates `patches/`. Plan 4 of #1259 adds a skia patch there too, and the two do not touch each other.
- Produces: nothing imported. `createSocketAdapter` is unchanged; the fix reaches it through the installed package.

- [ ] **Step 1: Write the tests**

```ts
// tests/server/postgresAdapterPatch.test.ts — patches/@socket.io+postgres-adapter+0.5.0.patch: the
// adapter hands back every LISTEN client it loses, and has one reconnection pending at most.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Pool, type PoolClient } from "pg";
import { PubSubClient } from "@socket.io/postgres-adapter/dist/util.js";

let listen: (client: EventEmitter) => Promise<unknown> = async () => ({ rows: [] });

class FakeClient extends EventEmitter {
  _queryable = true;
  connection = { stream: { unref() {}, ref() {} } };
  connect(cb: (err?: Error) => void) {
    setImmediate(() => cb());
  }
  query(text: string) {
    return text.startsWith("LISTEN") ? listen(this) : Promise.resolve({ rows: [] });
  }
  end(cb?: () => void) {
    this._queryable = false;
    setImmediate(() => this.emit("end"));
    cb?.();
    return Promise.resolve();
  }
  ref() {}
  unref() {}
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

function start(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const pool = new Pool({ Client: FakeClient as never, max: 4 });
  const acquired: PoolClient[] = [];
  pool.on("acquire", (c) => acquired.push(c));
  const opts = { channelPrefix: "c", tableName: "t", payloadThreshold: 8_000, cleanupInterval: 30_000, errorHandler() {} };
  const pubsub = new PubSubClient(pool, opts as never, () => false, () => {});
  pubsub.addNamespace("/");
  t.after(() => pubsub.close());
  return { pool, pubsub, acquired, checkedOut: () => pool.totalCount - pool.idleCount };
}

test("a LISTEN refused on a live connection hands its client back", async (t) => {
  let calls = 0;
  listen = async () => {
    calls += 1;
    if (calls === 1) throw new Error("LISTEN refused");
    return { rows: [] };
  };
  const { checkedOut } = start(t);
  await settle();
  assert.equal(checkedOut(), 0, "the client whose LISTEN failed is still checked out");
  t.mock.timers.tick(3_000);
  await settle();
  assert.equal(calls, 2);
  assert.equal(checkedOut(), 1);
});

test("a backend dying mid-LISTEN is handed back once and reconnected once", async (t) => {
  let calls = 0;
  listen = async (client) => {
    calls += 1;
    if (calls > 1) return { rows: [] };
    client.emit("end");
    throw new Error("Connection terminated unexpectedly");
  };
  const { checkedOut } = start(t);
  await settle();
  assert.equal(checkedOut(), 0, "the dead client is still checked out");
  t.mock.timers.tick(3_000);
  await settle();
  assert.equal(calls, 2, `${calls - 1} reconnections ran: each extra LISTEN client delivers every broadcast again`);
  assert.equal(checkedOut(), 1);
});

test("an established LISTEN client that ends gives its slot back, every time", async (t) => {
  listen = async () => ({ rows: [] });
  const { pool, pubsub, acquired, checkedOut } = start(t);
  await settle();
  for (const round of [1, 2]) {
    assert.equal(checkedOut(), 1, `round ${round}: no LISTEN client`);
    acquired.at(-1)!.emit("end");
    await settle();
    assert.equal(checkedOut(), 0, `round ${round}: the ended client still holds its slot`);
    t.mock.timers.tick(3_000);
    await settle();
  }
  pubsub.close();
  assert.equal(pool.idleCount, 1, "close() did not hand the LISTEN client back idle, so pool.end() tests nothing");
  await pool.end();
});

test("close() leaves no reconnection behind", async (t) => {
  let calls = 0;
  listen = async (client) => {
    calls += 1;
    client.emit("end");
    throw new Error("Connection terminated unexpectedly");
  };
  const { pubsub } = start(t);
  await settle();
  pubsub.close();
  t.mock.timers.tick(3_000);
  await settle();
  assert.equal(calls, 1, "a reconnection scheduled before close() ran after it");
});
```

- The fake sets `_queryable = true`, so a release without an error idles the client (`pg-pool/index.js:392`) rather than removing it, and the third test asserts that before `pool.end()`. Its `end()` emits `end` the way `pg` does, so every release the pool makes also crosses the patch's late-`end` path.
- The second test emits `end` before the query rejects, which is the order a bare socket close gives (`pg/lib/client.js:203-228`). The patch's `released` flag makes the other order the same case.
- Timers are mocked, so the 1–3 s reconnection delay costs nothing and `tick(3_000)` always covers it.

- [ ] **Step 2: Run them and watch each fail for its own reason**

Run: `node --test tests/server/postgresAdapterPatch.test.ts`
Expected: 4 FAIL, against the unpatched install, with these messages (checked on 2026-09-28):
- `the client whose LISTEN failed is still checked out`
- `the dead client is still checked out`
- `round 1: the ended client still holds its slot`
- `a reconnection scheduled before close() ran after it`

The fourth is the double-scheduled reconnection by itself: `close()` clears only the second timer, and the first runs `initClient` after the close.

- [ ] **Step 3: Write `patches/@socket.io+postgres-adapter+0.5.0.patch`**

Create the file with exactly this content (LF line endings; `.gitattributes` sets `eol=lf`):

```diff
diff --git a/node_modules/@socket.io/postgres-adapter/dist/util.js b/node_modules/@socket.io/postgres-adapter/dist/util.js
index 498be25..2ee5339 100644
--- a/node_modules/@socket.io/postgres-adapter/dist/util.js
+++ b/node_modules/@socket.io/postgres-adapter/dist/util.js
@@ -55,14 +55,28 @@ class PubSubClient {
         }, opts.cleanupInterval);
     }
     scheduleReconnection() {
+        if (this.closed || this.reconnectTimer) {
+            return;
+        }
         const reconnectionDelay = Math.floor(2000 * (0.5 + Math.random()));
         debug("reconnection in %d ms", reconnectionDelay);
-        this.reconnectTimer = setTimeout(() => this.initClient(), reconnectionDelay);
+        this.reconnectTimer = setTimeout(() => {
+            this.reconnectTimer = undefined;
+            this.initClient();
+        }, reconnectionDelay);
     }
     async initClient() {
+        let client;
+        let released = false;
+        const release = (err) => {
+            if (client && !released) {
+                released = true;
+                client.release(err);
+            }
+        };
         try {
             debug("acquiring client from the pool");
-            const client = await this.pool.connect();
+            client = await this.pool.connect();
             debug("client acquired");
             client.on("notification", async (msg) => {
                 try {
@@ -84,18 +98,29 @@ class PubSubClient {
                 }
             });
             client.on("end", () => {
+                if (released) {
+                    return;
+                }
                 debug("client was closed, scheduling reconnection...");
-                this.client = undefined;
+                if (this.client === client) {
+                    this.client = undefined;
+                }
+                release(new Error("client was closed"));
                 this.scheduleReconnection();
             });
             for (const channel of this.channels) {
                 debug("client listening to %s", channel);
                 await client.query(`LISTEN "${channel}"`);
             }
+            if (this.closed) {
+                release(new Error("adapter was closed"));
+                return;
+            }
             this.client = client;
         }
         catch (e) {
             debug("error while initializing client, scheduling reconnection...");
+            release(e);
             this.scheduleReconnection();
         }
     }
@@ -147,6 +172,7 @@ class PubSubClient {
         await this.pool.query("SELECT pg_notify($1, $2)", [channel, headerPayload]);
     }
     close() {
+        this.closed = true;
         if (this.client) {
             this.client.removeAllListeners("end");
             this.client.release();
```

- Every release passes an error, so the pool destroys the client instead of idling it: a client that ran `LISTEN` would otherwise go back to the pool still subscribed and carrying the adapter's `notification` listener.
- `close()` keeps its own `release()` without an error, as upstream has it, because `pool.end()` follows it at shutdown.

- [ ] **Step 4: Dry-run the patch against a pristine copy, never against the shared install (Git Bash)**

Use a folder in your scratchpad directory, never `/tmp`, because Git Bash and Node resolve `/tmp` differently:

```bash
root="$(git rev-parse --show-toplevel)"; install="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/node_modules"
t="<scratchpad>/adapter-patch"; d="$t/node_modules/@socket.io/postgres-adapter/dist"; mkdir -p "$d"
cp "$install/@socket.io/postgres-adapter/dist/util.js" "$d/"
git -C "$t" init -q && git -C "$t" apply --check "$root/patches/@socket.io+postgres-adapter+0.5.0.patch" && echo applies
```

Expected: `applies`. If `--check` fails with the install unchanged, the patch text was altered while copying it (tabs, CRLF, a trailing space). If the shared install is somehow already patched, `--check` fails too; then run it with `-R` instead, since a reverse that applies is proof as well.

The tests stay red locally, because the shared install is unpatched and must stay so (Global Constraints). They go green on CI, where `npm ci` runs `postinstall`. Task 4 reads that run.

- [ ] **Step 5: Rerun the integration test, still red here**

Run: `node --test tests/integration/postgresRestart.test.ts` (with `DATABASE_URL` set)
Expected: the same result as Task 2 Step 11 (tests 5 and 6 FAIL), because this machine's install is unpatched. That is the red CI has to turn green. Then run its neighbours, which boot the same adapter and must still pass unpatched: `node --test tests/integration/crossInstance.test.ts`, then `node --test tests/integration/shutdown.test.ts` → PASS.

- [ ] **Step 6: Typecheck and lint**

`npx tsc --noEmit` and `npx eslint tests/server/postgresAdapterPatch.test.ts` → clean.

- [ ] **Step 7: Draft the upstream PR (filing it is the owner's call)**

The fix belongs in `socketio/socket.io-postgres-adapter`, in `lib/util.ts`, from which `dist/util.js` is compiled. Opening a PR there is an outward action on the owner's behalf. At execution, show the owner the text below and act only on their yes: fork, port the patch to `lib/util.ts` with a test in its mocha suite, and open the PR with `gh pr create -R socketio/socket.io-postgres-adapter --body-file <file>`. Otherwise leave the text in this branch's PR body under "Upstream".

```markdown
**fix: release the LISTEN client on every failure, and keep one reconnection pending at most**

`PubSubClient.initClient` (`lib/util.ts`) leaks in three ways:

1. When the `LISTEN` client's connection ends (a Postgres restart, `pg_terminate_backend`), the `end` handler clears `this.client` and reconnects but never calls `client.release()`. `pg-pool` keeps the dead client, so each restart costs a slot for good: with `max: 2`, one restart leaves every `pg_notify` waiting on `connectionTimeoutMillis`, and `pool.end()` never resolves.
2. When `LISTEN` fails on a live connection, the `catch` schedules a reconnection without releasing the client, so that slot leaks too.
3. When the backend dies while `LISTEN` is in flight, both the `end` handler and the `catch` call `scheduleReconnection()`. Two `initClient` runs then each check out a `LISTEN` client. The first is overwritten in `this.client` but keeps receiving notifications, so every message is delivered twice, and `close()` can clear only the second timer.

This PR releases the client once, with the error so the pool discards it, from both the `end` handler and the `catch`. It keeps at most one reconnection pending, and `close()` stops any pending reconnection and releases a client whose `LISTEN` completes after it.

We carry it as a patch-package patch, with a test per path: https://github.com/metasito/murlan/blob/main/patches/@socket.io+postgres-adapter+0.5.0.patch
```

- [ ] **Step 8: Commit**

```powershell
git add -- patches/@socket.io+postgres-adapter+0.5.0.patch tests/server/postgresAdapterPatch.test.ts
git commit -m "fix: the socket adapter hands back every LISTEN client it loses

@socket.io/postgres-adapter 0.5.0 never released a LISTEN client whose
connection ended or whose LISTEN failed, and a backend dying mid-LISTEN
scheduled two reconnections. With the test pool of 2, one restart starved every
pg_notify; with production's 4, three did. pool.end() at shutdown hung until the
forced exit. Patched at the source with patch-package.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Docs, and the pre-push checks

**Files:**
- Modify: `server/CLAUDE.md` § "Server invariants" (append one bullet)
- Modify: `docs/agents/checks.md:44` (the ports row)

- [ ] **Step 1: Add the invariant to `server/CLAUDE.md`**

Append to the "Server invariants — each is a bug that shipped" list:

```markdown
- **Every Postgres connection is opened by `server/store/pool.ts`.** `pg-pool` listens on a client
  only while it is idle, so a backend terminated under a checked-out one (the socket adapter's
  `LISTEN`, a transaction between statements) was an unhandled `error` that exited the process
  (`tests/server/pgConnections.test.ts`, `tests/integration/postgresRestart.test.ts`). The
  adapter's lost `LISTEN` clients are handed back by
  `patches/@socket.io+postgres-adapter+0.5.0.patch` (`tests/server/postgresAdapterPatch.test.ts`).
```

- [ ] **Step 2: Register the ports in `docs/agents/checks.md`**

Change line 44's first cell from `` `5561`, `5562`, `5571`, `5581` `` to `` `5561`, `5562`, `5571`, `5581`, `5591`, `5592` ``.

- [ ] **Step 3: Pre-push checks**

- `node --test tests/tooling/docReferences.test.ts tests/tooling/rulesAreSingleSourced.test.ts tests/tooling/integrationPorts.test.ts` → PASS
- `node tools/loop/comment-budget.mjs` → under budget. If it is over, cut comments from the code blocks above rather than trimming code to fit.
- `npm run agent:check` (rule 1). If the memory preflight refuses because other sessions are running, push and let CI decide, and say so in the PR. Expect `tests/server/postgresAdapterPatch.test.ts` red in any local run, for the reason in Task 3 Step 4.

- [ ] **Step 4: Commit**

```powershell
git add -- server/CLAUDE.md docs/agents/checks.md
git commit -m "docs: the one-connection-factory invariant, the restart test's ports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: After the push, read CI for what could not run here**

A green check mark is not enough, because a skip and an unapplied patch both pass quietly. In the run's logs, confirm:
- the `npm ci` step printed `@socket.io/postgres-adapter@0.5.0 ✔` under patch-package;
- `tests/server/postgresAdapterPatch.test.ts`: 4 pass;
- `tests/integration/postgresRestart.test.ts`: 7 pass, 0 skipped. The seventh test (SIGTERM) runs only there.

In the PR body, put the Task 3 Step 7 text under "Upstream". Add one line for the owner: after the merge, this machine's shared install stays unpatched until `npx patch-package` runs in the main checkout (or `npm ci`), and until then the patch test is red locally for every session.

---

## Self-review

- **Coverage:** the crash (Tasks 1–3), the `db.ts` sibling (Task 2, via `createPool("app", …)` and the listener on checked-out clients), resubscription (the adapter's own; Task 3's patch frees the slot it needs and stops the double reconnection), the ownership client's drop → reclaim (Task 1, fourth test), shutdown after a restart (Task 1, seventh test, on CI), the scan with a floor over every way to open a connection (Task 2, Steps 6–7), the integration test with its watched red (Task 1, Step 4, and the second red in Task 2, Step 11), ports and docs (Task 4). Design §7 asked for the scan and the terminate test, and both are here. The one departure from §7 (the release lives in the patch, not in `releaseEndedCheckouts`) is stated under **Spec**.
- **Placeholders:** none. Every code step carries its code, and every run step names its expected message. `<scratchpad>` in Task 3 Step 4 is the executing session's own scratchpad directory.
- **Names:** `createPool(name, config)`, `createClient(config, onError)`, `PubSubClient` and `patches/@socket.io+postgres-adapter+0.5.0.patch` are spelled the same in every task. `listenPattern`, `socketAdapterPoolStats` and `FORCED_EXIT_MS` are existing exports, used unchanged.
- **Verified before writing:** the scan's patterns against today's `server/` (Step 7's 12 extra entries) and against the planted cases. The patch against a pristine 0.5.0 `util.js` (`git apply --check`). Task 3's four tests, red against the installed adapter and green against the patched copy.
- **Budgets:** after the termination, every wait in Task 1 is an unscaled deadline of at most 10 s, and the SIGTERM wait is `FORCED_EXIT_MS` + 3 s (12.5 s), all inside `--test-timeout=30000`. The two tests built on `waitFor`, which is scaled ×4 on CI, carry their own `timeout`.
- **Review Focus:** items 2, 3 and 4 have tests in Task 3 (2 and 3 also in Task 1), and item 5 has one in Task 2. Item 6 is half tested: Task 3's fourth test covers a pending reconnection, and the `this.closed` check after `LISTEN` is left to the reviewer. Item 1 (refused connections during a real restart) is deliberately untested, because restarting the shared Postgres would fail peer files. It is left to the reviewer, with the source lines to read.
- **What only CI can show:** the patched adapter's tests and the integration test's green, because the shared install stays unpatched, and the SIGTERM test, because Windows has no SIGTERM. Task 4 Step 5 names what to read in that run.
