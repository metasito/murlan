import { Client, Pool, type ClientConfig, type PoolClient, type PoolConfig } from "pg";
import { logger } from "../shared/logger.ts";

/**
 * Upper bound on a single query on the app pool, server-side and client-side.
 *
 * `server/http/shutdown.ts` derives its entire budget from this: a client stuck on a
 * query is only returned to the pool when the query gives up, so this is the
 * longest a shutdown can be made to wait for one, and it has to leave room for
 * the rest of the sequence inside the platform's SIGTERM grace.
 */
export const QUERY_TIMEOUT_MS = 5_000;

/** How long a query on the app pool may wait for a connection before it gives up. */
const APP_CONNECT_TIMEOUT_MS = 5_000;

/** The longest a query on the app pool can take before it settles: the wait for a connection, then the query. */
export const APP_QUERY_BOUND_MS = APP_CONNECT_TIMEOUT_MS + QUERY_TIMEOUT_MS;

type Settings = Omit<ClientConfig, "connectionString" | "application_name">;

type Profile =
  | { kind: "pool"; max: number; settings: Settings & Omit<PoolConfig, "connectionString" | "application_name" | "max"> }
  | { kind: "client"; settings: Settings };

/**
 * Every use this server makes of Postgres, and how its connections are configured. A profile's
 * key is its `application_name` in `pg_stat_activity` (`murlan-<key>`), and a pool's `max` is
 * its share of `deploy/runtime.json`'s `pgConnectionsPerInstance` (`connectionsPerInstance`).
 */
const PROFILES = {
  app: {
    kind: "pool",
    max: 10,
    settings: {
      connectionTimeoutMillis: APP_CONNECT_TIMEOUT_MS,
      idleTimeoutMillis: 30_000,
      statement_timeout: QUERY_TIMEOUT_MS,
      query_timeout: QUERY_TIMEOUT_MS,
    },
  },
  // Bounded, so a half-open socket fails the heartbeat rather than hanging it, and a server that
  // accepts and never answers fails the connect every claim waits on.
  ownership: { kind: "client", settings: { connectionTimeoutMillis: 3_000, query_timeout: 5_000, statement_timeout: 5_000 } },
  admin: {
    kind: "pool",
    max: 2,
    settings: {
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 30_000,
      query_timeout: 30_000,
    },
  },
  ddl: {
    kind: "client",
    settings: { connectionTimeoutMillis: 5_000, query_timeout: 0, statement_timeout: 0, lock_timeout: 3_000 },
  },
  health: {
    kind: "pool",
    max: 1,
    settings: {
      connectionTimeoutMillis: 2_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 2_000,
      query_timeout: 2_000,
    },
  },
} as const satisfies Record<string, Profile>;

type ProfileName = keyof typeof PROFILES;
type ProfileOf<K extends Profile["kind"]> = {
  [N in ProfileName]: (typeof PROFILES)[N]["kind"] extends K ? N : never;
}[ProfileName];
export type PoolProfile = ProfileOf<"pool">;
export type ClientProfile = ProfileOf<"client">;

const EVERY_CONNECTION = {
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  idle_in_transaction_session_timeout: 10_000,
} as const satisfies Settings;

const POOL_LIFETIME_SECONDS = 1_800;

export function applicationName(profile: ProfileName): string {
  return `murlan-${profile}`;
}

/** A pool's deployed size: what `connectionsPerInstance` counts it as. */
export function profileMax(profile: PoolProfile): number {
  return PROFILES[profile].max;
}

export function connectionsPerInstance(): number {
  return Object.values(PROFILES).reduce((sum, p: Profile) => sum + (p.kind === "pool" ? p.max : 1), 0);
}

const opened = new Map<Pool, string>();

/** What each pool still open holds and queues, summed by pool name. */
export function poolMeters(): { pool: string; total: number; idle: number; waiting: number }[] {
  const meters = new Map<string, { pool: string; total: number; idle: number; waiting: number }>();
  for (const [pool, name] of opened) {
    if (pool.ended) {
      opened.delete(pool);
      continue;
    }
    const meter = meters.get(name) ?? { pool: name, total: 0, idle: 0, waiting: 0 };
    meter.total += pool.totalCount;
    meter.idle += pool.idleCount;
    meter.waiting += pool.waitingCount;
    meters.set(name, meter);
  }
  return [...meters.values()];
}

export function createPool(
  profile: PoolProfile,
  overrides: Omit<PoolConfig, "connectionString" | "application_name"> = {}
): Pool {
  const { max, settings } = PROFILES[profile];
  const pool = new Pool({
    ...EVERY_CONNECTION,
    maxLifetimeSeconds: POOL_LIFETIME_SECONDS,
    max,
    ...settings,
    ...overrides,
    application_name: applicationName(profile),
    connectionString: process.env.DATABASE_URL,
  });
  // Every client error is logged below; this only absorbs pg-pool's re-emit for an idle one.
  pool.on("error", () => {});
  // pg-pool listens on a client only while it is idle: a backend dying under a checked-out one
  // (a transaction between statements) emits with nobody listening.
  pool.on("connect", (client) => {
    client.on("error", (err) => logger.error({ err, pool: applicationName(profile) }, "Postgres client error"));
  });
  opened.set(pool, applicationName(profile));
  return pool;
}

export function createClient(profile: ClientProfile, onError: (err: Error) => void): Client {
  const client = new Client({
    ...EVERY_CONNECTION,
    ...PROFILES[profile].settings,
    application_name: applicationName(profile),
    connectionString: process.env.DATABASE_URL,
  });
  client.on("error", onError);
  return client;
}

function appendCause(err: unknown, cause: unknown): unknown {
  if (!(err instanceof Error)) return new Error(String(err), { cause });
  const seen = new Set<Error>();
  let last = err;
  while (last.cause instanceof Error && !seen.has(last.cause)) {
    seen.add(last);
    last = last.cause;
  }
  if (last.cause === undefined) last.cause = cause;
  return err;
}

/**
 * Runs `body` in a transaction on a client of its own. A client that failed to begin, commit
 * or roll back is released with that error, so `pool` destroys it rather than handing it to
 * the next caller. When the rollback fails too, the body's error is still the one thrown, with
 * the rollback's at the end of its `cause` chain.
 */
export async function inTransaction<T>(pool: Pool, body: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
  } catch (err) {
    client.release(err as Error);
    throw err;
  }
  let result: T;
  try {
    result = await body(client);
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      client.release(rollbackErr as Error);
      throw appendCause(err, rollbackErr);
    }
    client.release();
    throw err;
  }
  try {
    await client.query("COMMIT");
  } catch (err) {
    client.release(err as Error);
    throw err;
  }
  client.release();
  return result;
}

/** Connections Postgres keeps for superusers and operators, outside every instance's share. */
const RESERVED_CONNECTIONS = 10;

let headroom: number | undefined;

/**
 * Connections left once every instance seen holds its full share, as of the last
 * `checkConnectionBudget`; below zero, the instances running can exhaust `max_connections`.
 * Undefined until a check has run.
 */
export function pgConnectionHeadroom(): number | undefined {
  return headroom;
}

/**
 * Reads the server's limit and who holds connections now, and records the headroom. Instances
 * are counted by their one ownership session each, so `ownershipConnected` says whether this
 * process's is among them yet: it connects on the first claim, not at boot.
 */
export async function checkConnectionBudget(
  db: Pick<Pool, "query">,
  ownershipConnected: boolean
): Promise<number> {
  const limit = await db.query<{ max_connections: string }>("SHOW max_connections");
  const held = await db.query<{ name: string; sessions: number }>(
    `SELECT application_name AS name, count(*)::int AS sessions FROM pg_stat_activity
      WHERE application_name LIKE 'murlan-%' GROUP BY application_name`
  );
  const maxConnections = Number(limit.rows[0]?.max_connections);
  const sessions = Object.fromEntries(held.rows.map((r) => [r.name, r.sessions]));
  const instances = (sessions[applicationName("ownership")] ?? 0) + (ownershipConnected ? 0 : 1);
  const perInstance = connectionsPerInstance();
  headroom = maxConnections - RESERVED_CONNECTIONS - instances * perInstance;
  if (headroom < 0) {
    logger.error(
      { maxConnections, reserved: RESERVED_CONNECTIONS, instances, perInstance, headroom, sessions },
      "The instances running can hold more Postgres connections than the server allows"
    );
  }
  return headroom;
}
