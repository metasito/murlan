// tests/integration/schemaBootstrap.test.ts — a database the server has never
// seen must work on the first boot, with no manual step.
//
// The bug this pins: nothing created connect-pg-simple's `session` table.
// `drizzle-kit push` excludes it and the store runs with
// createTableIfMissing: false, so on any fresh or reprovisioned database every
// login and registration failed with `relation "session" does not exist` — and
// the error handler handed that sentence to the client.
//
// startTestServer() now creates an empty Postgres schema and nothing else, so
// everything below runs against tables `ensureSchema()` made at boot.
//
// One server for the whole file: `server/db.ts`'s pool is a module singleton
// that stop() closes, so a second startTestServer() in the same process cannot
// work. The subtests run in order and the destructive one is last.
import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { hasDatabase, skipMessage, startTestServer } from "../helpers/testServer.ts";

test("a fresh database is usable on the first boot", async (t) => {
  if (!hasDatabase()) {
    t.skip(skipMessage());
    return;
  }

  const baseUrl = process.env.DATABASE_URL!;
  const server = await startTestServer();
  // startTestServer() repoints DATABASE_URL at the throwaway schema; this pool
  // needs the unscoped connection string to query across schemas.
  const admin = new pg.Pool({ connectionString: baseUrl });

  try {
    const username = `fresh_${Date.now()}`;
    const credentials = { username, password: "password123", email: `${username}@example.test` };
    let cookie = "";

    await t.test("registration and login both succeed", async () => {
      const registered = await fetch(`${server.url}/api/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(credentials),
      });
      const registerBody = await registered.text();
      assert.equal(registered.status, 202, registerBody);
      assert.ok(
        registered.headers.get("set-cookie"),
        "registration must set a session cookie, which requires a working session store"
      );

      const loggedIn = await fetch(`${server.url}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(credentials),
      });
      const loginBody = await loggedIn.text();
      assert.equal(loggedIn.status, 200, loginBody);
      cookie = loggedIn.headers.get("set-cookie")!;
    });

    await t.test("the session round-trips through the store", async () => {
      const me = await fetch(`${server.url}/api/auth/me`, { headers: { cookie } });
      const body = await me.text();
      assert.equal(me.status, 200, body);
      assert.equal(
        (JSON.parse(body) as { username: string }).username,
        credentials.username
      );
    });

    await t.test("the session table has connect-pg-simple's expiry index", async () => {
      const { rows } = await admin.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'session'`,
        [server.schema]
      );
      const names = rows.map((r) => r.indexname);
      assert.ok(
        names.includes("IDX_session_expire"),
        `expiry index missing; found: ${names.join(", ") || "none"}`
      );
    });

    await t.test("every table in shared/schema.ts was created", async () => {
      const schemaModule = await import("../../shared/schema.ts");
      const { is } = await import("drizzle-orm");
      const { getTableConfig, PgTable } = await import("drizzle-orm/pg-core");
      const expected = Object.values(schemaModule)
        .filter((v) => is(v, PgTable))
        .map((table) => getTableConfig(table as never).name)
        .concat("session")
        .sort();

      const { rows } = await admin.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
        [server.schema]
      );
      const actual = rows.map((r) => r.table_name).sort();
      assert.deepEqual(
        expected.filter((name) => !actual.includes(name)),
        [],
        `boot left tables uncreated. present: ${actual.join(", ")}`
      );
    });

    await t.test("every index in shared/schema.ts was created, method included", async () => {
      const schemaModule = await import("../../shared/schema.ts");
      const { is } = await import("drizzle-orm");
      const { getTableConfig, PgTable } = await import("drizzle-orm/pg-core");
      const expected = Object.values(schemaModule)
        .filter((v) => is(v, PgTable))
        .flatMap((table) => getTableConfig(table as never).indexes)
        .map((idx) => idx.config.name!)
        .sort();

      const { rows } = await admin.query<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1`,
        [server.schema]
      );
      const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]));
      assert.deepEqual(
        expected.filter((name) => !byName.has(name)),
        [],
        `boot left indexes uncreated. present: ${[...byName.keys()].join(", ")}`
      );

      // The one index that is useless in the wrong access method: the replay
      // list filters `player_ids @> '[...]'`, which btree cannot answer.
      const ownership = byName.get("match_replays_player_ids_idx");
      assert.ok(ownership, "no index on match_replays.player_ids");
      assert.match(ownership, /USING gin /);
    });

    await t.test("re-running the bootstrap changes nothing", async () => {
      // What every Replit restart does: the same statements against tables,
      // indexes and enum types that already exist.
      const { ensureSchema } = await import("../../server/schemaDdl.ts");
      const { pool } = await import("../../server/db.ts");
      await ensureSchema(pool);
      await ensureSchema(pool);

      const me = await fetch(`${server.url}/api/auth/me`, { headers: { cookie } });
      assert.equal(me.status, 200, await me.text());
    });

    await t.test("an internal failure does not describe the database", async () => {
      // The reported failure, reproduced exactly: a client holding a valid
      // cookie against a database whose session table has gone. express-session
      // hands the store's error to the error middleware, which used to answer
      // with it verbatim.
      await admin.query(`DROP TABLE "${server.schema}"."session"`);

      const res = await fetch(`${server.url}/api/auth/me`, { headers: { cookie } });
      const body = await res.text();
      assert.equal(res.status, 500, body);
      assert.doesNotMatch(
        body,
        /relation|session|does not exist|pg_|SELECT|INSERT/i,
        `the response described the database: ${body}`
      );
      assert.equal(
        (JSON.parse(body) as { code?: string }).code,
        "INTERNAL_SERVER_ERROR",
        "the client needs a stable code to localise, since the message is English"
      );
    });
  } finally {
    await admin.end();
    await server.stop();
  }
});
