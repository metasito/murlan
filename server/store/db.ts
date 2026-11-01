import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { checkConnectionBudget, createPool, inTransaction, profileMax } from "./pool.ts";
import { drainPool } from "./drainPool.ts";
import { logger } from "../shared/logger.ts";
import * as schema from "../../shared/schema.ts";

export { QUERY_TIMEOUT_MS } from "./pool.ts";

/**
 * `MURLAN_PG_POOL_MAX`, or the deployed default when it is unset.
 *
 * The integration suites are why this is a knob: `node --test` gives every test file its own
 * process and runs as many of them at once as there are cores, so the ceiling that matters is
 * `files in flight x this number` against Postgres' `max_connections`, and the deployed size
 * overruns a stock 100 well before the suite finishes starting.
 *
 * Refuses anything that is not a positive integer rather than handing `pg` the
 * `NaN` a typo produces: a pool with no usable ceiling fails later, somewhere
 * else, as a connection error.
 */
export function resolvePoolMax(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return profileMax("app");
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      `MURLAN_PG_POOL_MAX must be a positive integer, got ${JSON.stringify(raw)}`
    );
  }
  return parsed;
}

export type Database = NodePgDatabase<typeof schema>;

declare const inTransactionBrand: unique symbol;
/** A `Database` bound to one client inside `transaction`; only `transaction` makes one. */
export type Tx = Database & { readonly [inTransactionBrand]: true };

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
  const appPool = createPool("app", { max: resolvePoolMax(process.env.MURLAN_PG_POOL_MAX) });
  open = { pool: appPool, db: drizzle(appPool, { schema }) };
}

export function transaction<T>(body: (tx: Tx) => Promise<T>): Promise<T> {
  return inTransaction(pool(), (client) => body(drizzle(client, { schema }) as unknown as Tx));
}

const BUDGET_CHECK_MS = 60_000;
let budgetCheck: ReturnType<typeof setInterval> | null = null;

/** Checks the connection budget now and then each minute, until `closeDatabase`. */
export async function watchConnectionBudget(): Promise<void> {
  const check = () =>
    checkConnectionBudget(pool()).catch((err: unknown) =>
      logger.warn({ err }, "Could not check the Postgres connection budget")
    );
  if (budgetCheck) clearInterval(budgetCheck);
  budgetCheck = setInterval(() => void check(), BUDGET_CHECK_MS);
  (budgetCheck as unknown as { unref?: () => void }).unref?.();
  await check();
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
  if (budgetCheck) {
    clearInterval(budgetCheck);
    budgetCheck = null;
  }
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
