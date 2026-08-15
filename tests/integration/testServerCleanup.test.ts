import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { hasDatabase, skipMessage, startTestServer } from "../helpers/testServer.ts";

/**
 * Proves startTestServer()'s cleanup-on-failure path actually runs. The
 * realistic trigger for a post-schema-creation failure is a stale
 * SCHEMA_DDL (e.g. after shared/schema.ts changes without a matching edit
 * in tests/helpers/testServer.ts) — simulated here directly via
 * StartTestServerOptions.ddlOverride, a test-only escape hatch.
 *
 * Needs a real database (same as every other integration test); skips
 * cleanly via hasDatabase()/skipMessage() when none is configured.
 */

async function countTestSchemas(connectionString: string): Promise<number> {
  const admin = new pg.Pool({ connectionString });
  try {
    const { rows } = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM information_schema.schemata WHERE schema_name LIKE 'test\\_%'`
    );
    return Number(rows[0].count);
  } finally {
    await admin.end();
  }
}

test("startTestServer() cleans up after a failure during schema push", async (t) => {
  if (!hasDatabase()) {
    t.skip(skipMessage());
    return;
  }

  const originalDatabaseUrl = process.env.DATABASE_URL!;
  const before = await countTestSchemas(originalDatabaseUrl);

  await assert.rejects(
    () => startTestServer({ ddlOverride: "THIS IS NOT VALID SQL AT ALL;" }),
    /syntax error/i,
    "expected the bad DDL to fail with a Postgres syntax error"
  );

  assert.equal(
    process.env.DATABASE_URL,
    originalDatabaseUrl,
    "DATABASE_URL must be restored to its original value after a failed startTestServer()"
  );

  const after = await countTestSchemas(originalDatabaseUrl);
  assert.equal(
    after,
    before,
    "the throwaway schema created before the DDL failure must be dropped, not leaked"
  );
});
