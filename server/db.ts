import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../shared/schema.ts";
import { logger } from "./logger.ts";

/**
 * Upper bound on a single query, server-side and client-side.
 *
 * `server/shutdown.ts` derives its entire budget from this: a client stuck on a
 * query is only returned to the pool when the query gives up, so this is the
 * longest a shutdown can be made to wait for one, and it has to leave room for
 * the rest of the sequence inside the platform's SIGTERM grace.
 */
export const QUERY_TIMEOUT_MS = 5_000;

/**
 * Clients this process may hold at once.
 *
 * Ten is the deployed figure, tuned against Replit's connection cap for the one
 * server process that runs there. The integration suites are the other case:
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

const POOL_MAX = resolvePoolMax(process.env.MURLAN_PG_POOL_MAX);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("neon.tech")
    ? { rejectUnauthorized: false }
    : false,
  max: POOL_MAX,
  // Every bound here is a failure mode with a deadline rather than a hang:
  // without them a caller waits forever for a free client, and a single stuck
  // backend query holds one of the ten slots for as long as it likes.
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  statement_timeout: QUERY_TIMEOUT_MS,
  query_timeout: QUERY_TIMEOUT_MS,
});

// `pg` emits `error` on the Pool when a backend or network failure reaches an
// *idle* client — no caller is awaiting it, so with no listener here Node
// treats it as an unhandled 'error' event on an EventEmitter.
pool.on("error", (err) => logger.error({ err }, "Idle Postgres client error"));

export const db = drizzle(pool, { schema });
