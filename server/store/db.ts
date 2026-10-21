import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { createPool } from "./pool.ts";
import { drainPool } from "./drainPool.ts";
import { logger } from "../shared/logger.ts";
import * as schema from "../../shared/schema.ts";

/**
 * Upper bound on a single query, server-side and client-side.
 *
 * `server/http/shutdown.ts` derives its entire budget from this: a client stuck on a
 * query is only returned to the pool when the query gives up, so this is the
 * longest a shutdown can be made to wait for one, and it has to leave room for
 * the rest of the sequence inside the platform's SIGTERM grace.
 */
export const QUERY_TIMEOUT_MS = 5_000;

/**
 * Clients this process may hold at once.
 *
 * Ten is the deployed figure; with the socket adapter's pool and the ownership
 * client it must fit `deploy/runtime.json`'s `pgConnectionsPerInstance`. The integration suites are the other case:
 * `node --test` gives every test file its own process and runs as many of them
 * at once as there are cores, so the ceiling that matters is
 * `files in flight x this number` against Postgres' `max_connections`, and ten
 * overruns a stock 100 well before the suite finishes starting.
 */
const DEFAULT_POOL_MAX = 10;

/**
 * `MURLAN_PG_POOL_MAX`, or the deployed default when it is unset.
 *
 * Refuses anything that is not a positive integer rather than handing `pg` the
 * `NaN` a typo produces: a pool with no usable ceiling fails later, somewhere
 * else, as a connection error.
 */
export function resolvePoolMax(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_POOL_MAX;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      `MURLAN_PG_POOL_MAX must be a positive integer, got ${JSON.stringify(raw)}`
    );
  }
  return parsed;
}

export type Database = NodePgDatabase<typeof schema>;

/** A query reached the database before boot opened it, or after shutdown closed it. */
export class DatabaseNotOpenError extends Error {
  constructor() {
    super("The database is not open: createApp() opens it, and closeDatabase() closes it");
    this.name = "DatabaseNotOpenError";
  }
}

let open: { pool: Pool; db: Database } | null = null;

export function openDatabase(): void {
  if (open) throw new Error("The database is already open: closeDatabase() the first one");
  const appPool = createPool("app", {
    max: resolvePoolMax(process.env.MURLAN_PG_POOL_MAX),
    // Every bound here is a failure mode with a deadline rather than a hang:
    // without them a caller waits forever for a free client, and a single stuck
    // backend query holds one of the ten slots for as long as it likes.
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: QUERY_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
  });
  open = { pool: appPool, db: drizzle(appPool, { schema }) };
}

export function pool(): Pool {
  if (!open) throw new DatabaseNotOpenError();
  return open.pool;
}

export function db(): Database {
  if (!open) throw new DatabaseNotOpenError();
  return open.db;
}

/**
 * Waits up to `drainMs` for the pool to go quiet, then ends it; `ended` settles
 * once it has. A pool still busy past `drainMs` is logged and ended anyway, and
 * its `ended` may never settle — `pool.end()` waits on every checked-out client
 * — so a caller with a deadline bounds the wait itself.
 *
 * The drain comes first because the writes this protects — `handleRoundOver`,
 * `persistGameState`, a disconnect's teardown — are fire-and-forget, and
 * nothing else holds a promise for any of them.
 */
export async function closeDatabase({ drainMs }: { drainMs?: number } = {}): Promise<{ ended: Promise<void> }> {
  if (!open) return { ended: Promise.resolve() };
  const closing = open.pool;
  if (!(await drainPool(closing, { timeoutMs: drainMs }))) {
    // While still open: the error recorder writes this line through db().
    logger.error(
      { busy: closing.totalCount - closing.idleCount, waiting: closing.waitingCount },
      "Postgres pool still busy after the drain window — in-flight writes are being abandoned"
    );
  }
  open = null;
  return { ended: closing.end().catch((err) => logger.error({ err }, "Pool close failed")) };
}
