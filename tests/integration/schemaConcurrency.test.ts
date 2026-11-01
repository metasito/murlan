// tests/integration/schemaConcurrency.test.ts — every instance of a deploy runs the boot DDL at
// once, on its own connection, and every one of them must start.
import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { dropSchema, hasDatabase, scopedDatabaseUrl, skipMessage } from "../helpers/testServer.ts";
import { ensureSchema, openDdlClient, schemaStatements } from "../../server/store/schemaDdl.ts";
import { DatabaseNotOpenError, pool } from "../../server/store/db.ts";
import { eventually } from "../helpers/client.ts";

const baseUrl = process.env.DATABASE_URL ?? "";

async function inFreshSchema(
  run: (sql: pg.Client) => Promise<void>,
  url = (schema: string) => scopedDatabaseUrl(baseUrl, schema)
): Promise<void> {
  const schema = `test_ddl_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.query(`SET search_path = "${schema}"`);
  process.env.DATABASE_URL = url(schema);
  try {
    await run(admin);
  } finally {
    process.env.DATABASE_URL = baseUrl;
    await admin.end();
    await dropSchema(baseUrl, schema);
  }
}

async function invalidIndexes(sql: pg.Client): Promise<string[]> {
  const { rows } = await sql.query<{ name: string }>(
    `SELECT c.relname AS name FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relnamespace = current_schema()::regnamespace AND NOT i.indisvalid`
  );
  return rows.map((r) => r.name);
}

for (const boots of [2, 4]) {
  test(`${boots} concurrent boots on an empty database all ensure the schema`, async (t) => {
    if (!hasDatabase()) return t.skip(skipMessage());
    await inFreshSchema(async (sql) => {
      const results = await Promise.allSettled(Array.from({ length: boots }, () => ensureSchema()));
      assert.deepEqual(
        results.flatMap((r) => (r.status === "rejected" ? [String(r.reason)] : [])),
        [],
        "a boot failed against a peer's DDL"
      );
      const declared = schemaStatements()
        .map((s) => /INDEX CONCURRENTLY IF NOT EXISTS "([^"]+)"/.exec(s)?.[1])
        .filter((name): name is string => Boolean(name));
      const { rows } = await sql.query<{ indexname: string }>(
        "SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()"
      );
      const present = new Set(rows.map((r) => r.indexname));
      assert.ok(declared.length > 10, `the schema declares ${declared.length} indexes: the check reads nothing`);
      assert.deepEqual(declared.filter((name) => !present.has(name)), []);
      assert.deepEqual(await invalidIndexes(sql), []);
    });
  });
}

test("an index a failed concurrent build left INVALID is dropped and rebuilt at boot", async (t) => {
  if (!hasDatabase()) return t.skip(skipMessage());
  await inFreshSchema(async (sql) => {
    await ensureSchema();
    await sql.query(`DROP INDEX "events_occurred_idx"`);
    await sql.query(`INSERT INTO "events" ("name") VALUES ('dup'), ('dup')`);
    await assert.rejects(
      sql.query(`CREATE UNIQUE INDEX CONCURRENTLY "events_occurred_idx" ON "events" ("name")`),
      /could not create unique index/
    );
    assert.deepEqual(await invalidIndexes(sql), ["events_occurred_idx"], "the fixture left no INVALID index");

    await ensureSchema();

    assert.deepEqual(await invalidIndexes(sql), []);
    const { rows } = await sql.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'events_occurred_idx'"
    );
    assert.equal(rows.length, 1);
    assert.match(rows[0].indexdef, /^CREATE INDEX .* \(occurred_at\)$/);
  });
});

const leftovers = {
  "a missing index": async (sql: pg.Client) => {
    await sql.query(`DROP INDEX "IDX_session_expire"`);
    return "IDX_session_expire";
  },
  "an INVALID index": async (sql: pg.Client) => {
    await sql.query(`DROP INDEX "events_occurred_idx"`);
    await sql.query(`INSERT INTO "events" ("name") VALUES ('dup'), ('dup')`);
    await sql.query(`CREATE UNIQUE INDEX CONCURRENTLY "events_occurred_idx" ON "events" ("name")`).catch(() => {});
    assert.deepEqual(await invalidIndexes(sql), ["events_occurred_idx"], "the fixture left no INVALID index");
    return "events_occurred_idx";
  },
};

for (const [leftover, make] of Object.entries(leftovers)) {
  test(`boot waits out a reader's old snapshot to build ${leftover}, rather than failing on lock_timeout`, async (t) => {
    if (!hasDatabase()) return t.skip(skipMessage());
    await inFreshSchema(async (sql) => {
      await ensureSchema();
      const index = await make(sql);
      const { rows: [{ schema }] } = await sql.query<{ schema: string }>("SELECT current_schema() AS schema");
      const reader = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await reader.connect();
      try {
        await reader.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
        await reader.query(`SELECT count(*) FROM "users"`);

        const boot = ensureSchema().then(() => "booted", (err: unknown) => `boot failed: ${String(err)}`);
        const waitedPastLockTimeout = eventually(
          async () =>
            (
              await sql.query(
                `SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND query LIKE '%INDEX CONCURRENTLY%'
                    AND wait_event_type = 'Lock' AND now() - query_start > interval '3500 ms'`,
                [schema]
              )
            ).rowCount,
          "the index build to be waiting on the reader past the 3 s lock_timeout",
          10_000
        ).then(() => "waiting");
        assert.equal(await Promise.race([boot, waitedPastLockTimeout]), "waiting");
        await reader.query("ROLLBACK");
        assert.equal(await boot, "booted");
      } finally {
        await reader.end();
      }
      assert.deepEqual(await invalidIndexes(sql), []);
      const { rowCount } = await sql.query(
        "SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = $1",
        [index]
      );
      assert.equal(rowCount, 1);
    });
  });
}

test("the boot DDL runs on a connection of its own, with no statement or query timeout", async (t) => {
  if (!hasDatabase()) return t.skip(skipMessage());
  const withDefaultTimeout = (schema: string) =>
    scopedDatabaseUrl(baseUrl, schema).replace("search_path%3D", "statement_timeout%3D50%20-c%20search_path%3D");
  await inFreshSchema(async () => {
    assert.throws(() => pool(), DatabaseNotOpenError, "this process opened the app pool, so this proves nothing");
    await ensureSchema();

    const ddl = await openDdlClient();
    try {
      const setting = async (name: string) => (await ddl.query(`SHOW ${name}`)).rows[0][name];
      assert.equal(await setting("statement_timeout"), "0");
      assert.equal(await setting("lock_timeout"), "3s");
      const { query_timeout } = (ddl as unknown as { connectionParameters: { query_timeout: unknown } })
        .connectionParameters;
      assert.ok(!query_timeout, `the client times out its own queries at ${String(query_timeout)}ms`);
    } finally {
      await ddl.end();
    }
  }, withDefaultTimeout);
});
