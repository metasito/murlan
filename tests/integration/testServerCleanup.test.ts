import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { hasDatabase, skipMessage, startTestServer } from "../helpers/testServer.ts";

/**
 * Proves startTestServer()'s cleanup-on-failure path actually runs. A failure
 * between CREATE SCHEMA and boot is simulated via
 * StartTestServerOptions.ddlOverride, a test-only escape hatch.
 *
 * Needs a real database (same as every other integration test); skips
 * cleanly via hasDatabase()/skipMessage() when none is configured.
 */

async function schemaExists(
  connectionString: string,
  schemaName: string
): Promise<boolean> {
  const admin = new pg.Pool({ connectionString });
  try {
    const { rows } = await admin.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name = $1) AS exists`,
      [schemaName]
    );
    return rows[0].exists;
  } finally {
    await admin.end();
  }
}

test("startTestServer() cleans up after a failure during boot", async (t) => {
  if (!hasDatabase()) {
    t.skip(skipMessage());
    return;
  }

  const originalDatabaseUrl = process.env.DATABASE_URL!;

  // First, verify the happy path: schema is created and then dropped on stop()
  const server = await startTestServer();
  const testSchema = server.schema;

  const existsBeforeStop = await schemaExists(originalDatabaseUrl, testSchema);
  assert.ok(existsBeforeStop, `the created schema ${testSchema} must exist`);

  await server.stop();

  const existsAfterStop = await schemaExists(originalDatabaseUrl, testSchema);
  assert.equal(
    existsAfterStop,
    false,
    `the schema ${testSchema} must be dropped on stop()`
  );

  // Then, verify the failure path: the schema is created but dropped again
  // when boot fails afterwards
  await assert.rejects(
    () => startTestServer({ failAfterSchemaCreate: true }),
    /forced failure after CREATE SCHEMA/,
    "expected the injected failure to propagate"
  );

  assert.equal(
    process.env.DATABASE_URL,
    originalDatabaseUrl,
    "DATABASE_URL must be restored to its original value after a failed startTestServer()"
  );
});
