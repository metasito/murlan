// tests/integration/userLock.test.ts — holdRowLock counts the writers waiting on its row, and nothing else.
import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { eventually } from "../helpers/client.ts";
import { holdRowLock } from "../helpers/userLock.ts";

const available = Boolean(process.env.DATABASE_URL);

test("a CREATE INDEX CONCURRENTLY waiting out a blocked writer's transaction is not another writer waiting on the row", { skip: !available && "no DATABASE_URL" }, async () => {
  const table = `lock_probe_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  // Its own pool: the lock under test must not share a connection with anything else.
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  let lock: Awaited<ReturnType<typeof holdRowLock>> | undefined;
  let indexing: Promise<unknown> | undefined;
  try {
    await pool.query(`CREATE TABLE "${table}" (id int PRIMARY KEY, n int)`);
    await pool.query(`INSERT INTO "${table}" VALUES (1, 0)`);
    lock = await holdRowLock(`SELECT id FROM "${table}" WHERE id = 1 FOR UPDATE`, []);

    const writer = pool.query(`UPDATE "${table}" SET n = 1 WHERE id = 1`);
    await lock.waitForBlocked(1);
    indexing = pool.query(`CREATE INDEX CONCURRENTLY "${table}_n" ON "${table}" (n)`);
    indexing.catch(() => undefined);
    await eventually(async () => {
      const { rows } = await pool.query(`SELECT 1 FROM pg_stat_activity WHERE query LIKE 'CREATE INDEX CONCURRENTLY "${table}_n"%' AND cardinality(pg_blocking_pids(pid)) > 0`);
      return rows.length > 0;
    }, "the index build to wait on the blocked writer's transaction");
    assert.equal((await lock.blocked()).length, 1, "the index build counted as a writer");
    await lock.release();
    await writer;
    await indexing;
  } finally {
    await lock?.release();
    await indexing?.catch(() => undefined);
    await pool.query(`DROP TABLE IF EXISTS "${table}"`);
    await pool.end();
  }
});

test("a CREATE INDEX CONCURRENTLY waiting on the lock's own transaction is not a writer either", { skip: !available && "no DATABASE_URL" }, async () => {
  const table = `lock_probe_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  // Its own pool: the lock under test must not share a connection with anything else.
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  let lock: Awaited<ReturnType<typeof holdRowLock>> | undefined;
  let indexing: Promise<unknown> | undefined;
  try {
    await pool.query(`CREATE TABLE "${table}" (id int PRIMARY KEY, n int)`);
    await pool.query(`INSERT INTO "${table}" VALUES (1, 0)`);
    // An open cursor keeps the transaction's snapshot, which is what an index build waits out.
    lock = await holdRowLock(`SELECT id FROM "${table}" WHERE id = 1 FOR UPDATE; DECLARE probe CURSOR FOR SELECT * FROM "${table}"`, []);
    indexing = pool.query(`CREATE INDEX CONCURRENTLY "${table}_n" ON "${table}" (n)`);
    indexing.catch(() => undefined);
    await eventually(async () => {
      const { rows } = await pool.query(`SELECT 1 FROM pg_stat_activity WHERE query LIKE 'CREATE INDEX CONCURRENTLY "${table}_n"%' AND cardinality(pg_blocking_pids(pid)) > 0`);
      return rows.length > 0;
    }, "the index build to wait on the lock's transaction");
    assert.deepEqual(await lock.blocked(), [], "the index build counted as a writer");
  } finally {
    await lock?.release();
    await indexing?.catch(() => undefined);
    await pool.query(`DROP TABLE IF EXISTS "${table}"`);
    await pool.end();
  }
});
