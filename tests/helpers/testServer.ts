import pg from "pg";
import type { Server as HttpServer } from "node:http";
import type { Server as SocketIOServer } from "socket.io";
// Pure by design: importing anything that reaches server/db.ts from module
// scope here would build the app's Pool before startTestServer() has pointed
// DATABASE_URL at the throwaway schema.
import { drainPool } from "../../server/drainPool.ts";

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Integration tests need a real Postgres. Someone checking out the repo
 * without one must still be able to run `npm test`, so integration suites
 * should skip (via this message) rather than fail.
 */
export function skipMessage(): string {
  return "DATABASE_URL not set — skipping integration tests (unit tests still run)";
}

export interface TestServer {
  url: string;
  port: number;
  schema: string;
  /** The live handles, for a suite that drives shutdown itself. */
  io: SocketIOServer;
  httpServer: HttpServer;
  stop(): Promise<void>;
}

async function dropSchema(baseUrl: string, schema: string): Promise<void> {
  const cleanup = new pg.Pool({ connectionString: baseUrl });
  try {
    await cleanup.query(`DROP SCHEMA "${schema}" CASCADE`);
  } finally {
    await cleanup.end();
  }
}

/**
 * Test-only escape hatch so a test can force a failure *after* the Postgres
 * schema has been created, to prove startTestServer()'s cleanup-on-failure
 * path actually runs (see tests/integration/testServerCleanup.test.ts). Not
 * part of the documented public contract — real callers never pass this.
 */
export interface StartTestServerOptions {
  failAfterSchemaCreate?: boolean;
}

/**
 * Boots the real Express + Socket.io app against a throwaway Postgres schema
 * so tests never touch development data. This creates the empty schema and
 * points `DATABASE_URL` at it; the tables inside it are created by the app's
 * own `ensureSchema()` during `createApp()`, exactly as they are in production.
 *
 * The schema is dropped on stop() — or, if anything after CREATE SCHEMA
 * throws, dropped and `DATABASE_URL` restored before rethrowing, so a failed
 * boot never leaks a schema or leaves the env var pointed at a connection
 * string that no longer resolves to anything valid.
 */
export async function startTestServer(
  opts: StartTestServerOptions = {}
): Promise<TestServer> {
  const schema = `test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const baseUrl = process.env.DATABASE_URL!;
  const admin = new pg.Pool({ connectionString: baseUrl });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.end();

  try {
    // Point every connection at the throwaway schema via search_path, and at
    // an ephemeral port, before importing the server (module scope reads
    // these — see server/db.ts, which builds its Pool at import time).
    const scopedUrl = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}options=-c%20search_path%3D${schema}`;
    process.env.DATABASE_URL = scopedUrl;
    process.env.PORT = "0";
    process.env.SESSION_SECRET ??= "test-secret-not-for-production";

    if (opts.failAfterSchemaCreate) {
      throw new Error("forced failure after CREATE SCHEMA");
    }

    // Dynamic import of testApp.ts (not index.ts): index.ts calls listen()
    // on the real PORT and installs SIGTERM/SIGINT handlers as a side
    // effect of being imported — importing it would start (and never stop)
    // a second, unwanted server. testApp.ts only builds the app and its
    // http.Server (with Socket.io already attached via server/socket.ts's
    // setupSocket); nothing binds a port until this harness explicitly
    // listens below.
    const { createApp } = await import("../../server/testApp.ts");
    // Same module identity as whatever createApp()'s import chain (session
    // store, storage) resolved — Node's ESM cache is keyed by specifier, so
    // this is the one live `pg.Pool` the running app holds open, not a new
    // one.
    const { pool: appPool } = await import("../../server/db.ts");
    const { server, io } = await createApp();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    return {
      url: `http://127.0.0.1:${port}`,
      port,
      schema,
      io,
      httpServer: server,
      async stop() {
        try {
          io.close();
          await new Promise<void>((resolve) => server.close(() => resolve()));
          // A suite whose assertions are satisfied early reaches teardown while
          // the tail of a fire-and-forget chain is still writing; ending the
          // pool under it abandons the write and fails the next one with
          // "Cannot use a pool after calling end on the pool". A pool that is
          // still busy after the bound is reported by the assertions that then
          // fail, so the result is not inspected here.
          await drainPool(appPool);
          // The app's own pool (session store + storage) is a module-level
          // singleton that nothing else closes — server/index.ts only does
          // so in its SIGTERM/SIGINT handler, which this harness never goes
          // through. Left open it both leaks a connection and keeps the
          // test process alive indefinitely.
          await appPool.end();
        } finally {
          // Always run, even if closing the server/pool above threw: a
          // failed shutdown must not also leak the schema or leave
          // DATABASE_URL pointed at the throwaway connection string.
          try {
            await dropSchema(baseUrl, schema);
          } finally {
            process.env.DATABASE_URL = baseUrl;
          }
        }
      },
    };
  } catch (err) {
    // Nothing was returned to the caller, so there is no stop() to call —
    // this is the only chance to undo the CREATE SCHEMA above and the
    // DATABASE_URL mutation.
    process.env.DATABASE_URL = baseUrl;
    try {
      await dropSchema(baseUrl, schema);
    } catch (cleanupErr) {
      // Best-effort: don't let a cleanup failure mask the original error
      // that made startTestServer() fail in the first place.
      console.error(
        `startTestServer: failed to drop schema "${schema}" after startup error`,
        cleanupErr
      );
    }
    throw err;
  }
}
