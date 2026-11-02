// tests/integration/pgSessions.test.ts — every session the server opens says what it is for in
// pg_stat_activity, and carries the timeouts and keep-alive its profile gives it.
import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { dropSchema, hasDatabase, skipMessage } from "../helpers/testServer.ts";
import { closeDatabase, openDatabase, pool } from "../../server/store/db.ts";
import { claimRoom, closeOwnership, ownershipKey, reopenOwnership } from "../../server/game/gameOwnership.ts";

test("each pool and client names its use, and the app pool bounds an idle transaction", async (t) => {
  if (!hasDatabase()) return t.skip(skipMessage());
  const baseUrl = process.env.DATABASE_URL!;
  const schema = `test_sessions_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  // No application_name in the URL: a URL's own name takes precedence over the profile's.
  process.env.DATABASE_URL = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}options=-c%20search_path%3D${schema}`;
  try {
    openDatabase();
    reopenOwnership({ onRoomLost: () => {} });
    const room = `pg-sessions-${schema}`;
    assert.equal(await claimRoom(room), true);

    const nameOf = async (pid: number) =>
      (await admin.query("SELECT application_name FROM pg_stat_activity WHERE pid = $1", [pid])).rows[0]
        ?.application_name;
    const backend = async (db: pg.Pool) => (await db.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const owner = await admin.query(
      `SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND objsubid = 1 AND granted
          AND ((classid::bigint << 32) | objid::bigint) = $1::bigint`,
      [ownershipKey(room)]
    );
    assert.equal(owner.rowCount, 1, "the room's lock is not held");

    assert.deepEqual(
      {
        app: await nameOf(await backend(pool())),
        ownership: await nameOf(owner.rows[0].pid),
      },
      { app: "murlan-app", ownership: "murlan-ownership" }
    );

    assert.equal(
      (await pool().query("SHOW idle_in_transaction_session_timeout")).rows[0].idle_in_transaction_session_timeout,
      "10s"
    );
    const { keepAlive, keepAliveInitialDelayMillis, maxLifetimeSeconds } = pool().options as pg.PoolConfig;
    assert.deepEqual({ keepAlive, keepAliveInitialDelayMillis, maxLifetimeSeconds }, {
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      maxLifetimeSeconds: 1_800,
    });
  } finally {
    await closeOwnership();
    await (await closeDatabase()).ended;
    process.env.DATABASE_URL = baseUrl;
    await admin.end();
    await dropSchema(baseUrl, schema);
  }
});
