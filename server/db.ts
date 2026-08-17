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

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("neon.tech")
    ? { rejectUnauthorized: false }
    : false,
  max: 10,
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
