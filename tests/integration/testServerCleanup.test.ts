import { mock, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { hasDatabase, skipMessage, startTestServer } from "../helpers/testServer.ts";
import { connectAs, eventually, waitFor } from "../helpers/client.ts";
import { logger } from "../../server/shared/logger.ts";
import { pendingKeys, TIMER_KINDS } from "../../server/game/gameTimers.ts";

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
  // Asked after stop() or a failed boot, when there is no app pool to ask.
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

test("stop() leaves no timer armed for the process to wait on", { skip: hasDatabase() ? false : skipMessage(), timeout: 60_000 }, async () => {
  const server = await startTestServer();
  const host = await connectAs(server, `tsc_h${Date.now() % 1e6}`);
  try {
    const created = waitFor(host.socket, "room:state");
    host.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 4 });
    await created;
    const dealt = waitFor(host.socket, "game:state", 15_000);
    host.socket.emit("room:start", { fillWithBots: true });
    await dealt;
    host.socket.close();
    await eventually(() => pendingKeys("disconnect").length > 0, "the seat's disconnect grace to be armed", 10_000);
  } finally {
    host.socket.close();
    await server.stop();
  }
  const armed = TIMER_KINDS.flatMap((kind) => pendingKeys(kind).map((key) => `${kind}:${key}`));
  assert.deepEqual(armed, []);
});

test("stop() with a socket still connected logs nothing at warn or above", { skip: hasDatabase() ? false : skipMessage(), timeout: 60_000 }, async () => {
  const server = await startTestServer();
  try {
    const { socket } = await connectAs(server, `tsq_${Date.now() % 1e6}`);
    const warned = mock.method(logger, "warn");
    const errored = mock.method(logger, "error");
    await server.stop();
    socket.close();
    const logged = [...warned.mock.calls, ...errored.mock.calls].map((c) => JSON.stringify(c.arguments[1] ?? c.arguments[0]));
    assert.deepEqual(logged, []);
  } finally {
    mock.restoreAll();
  }
});
