import { Pool } from "pg";
import { createAdapter } from "@socket.io/postgres-adapter";
import { logger } from "./logger.ts";

/**
 * Clients the adapter may hold. One is parked on `LISTEN` for the life of the
 * process and never returned, so this is "publishers, plus one" — every
 * broadcast this server sends is a `pg_notify` on one of the rest.
 *
 * Deliberately not `server/db.ts`'s pool. Sharing it would put every broadcast
 * behind the application's own query load: under pool exhaustion a publish
 * waits on `connectionTimeoutMillis` and is then swallowed by the adapter's
 * error handler, which is a silently undelivered game state. It would also
 * spend one of the ten connections Replit is tuned for on a client that never
 * runs a query.
 */
const DEFAULT_POOL_MAX = 4;

function poolMax(): number {
  const parsed = Number(process.env.MURLAN_SOCKET_ADAPTER_POOL_MAX);
  return Number.isInteger(parsed) && parsed >= 2 ? parsed : DEFAULT_POOL_MAX;
}

/**
 * `pg_notify` channels are scoped to the *database*, not to the schema, so two
 * servers pointed at one database talk to each other whatever their
 * `search_path` is. That is the point in production and a hazard everywhere
 * else: the integration suites give every file its own schema inside one
 * database, and on a shared channel each would receive the others' broadcasts
 * and count their servers when sizing an acknowledgement.
 *
 * Keying the channel to the schema makes the isolation the suites already have
 * cover this too, and leaves production — where no `search_path` is set — on
 * the adapter's own default.
 */
export function channelPrefix(databaseUrl: string | undefined): string {
  // `options` can carry several `-c` clauses separated by encoded spaces, so
  // the value ends at the first `%20` as surely as at an `&`. Reading to the
  // next `&` alone swallows every later clause into the "schema", and two
  // instances on one schema whose other options differ would then compute
  // different channels and quietly stop hearing each other.
  const raw = databaseUrl?.match(/(?:^|[?&=\s]|%20)search_path(?:%3D|=)(.+)$/i)?.[1];
  const schema = raw?.split(/&|%20|\s/i)[0];
  return schema ? `socket.io#${decodeURIComponent(schema)}` : "socket.io";
}

/**
 * The `LIKE` pattern that matches this server's own `LISTEN`, as Postgres
 * reports it in `pg_stat_activity`.
 *
 * Only the prefix is escaped. Escaping the assembled string would turn the
 * trailing wildcard into a literal percent sign, and the pattern would then
 * match nothing at all — which is invisible, because the caller's only
 * response to never matching is to wait out its timeout.
 */
export function listenPattern(databaseUrl: string | undefined): string {
  const prefix = channelPrefix(databaseUrl).replace(/[\\_%]/g, (c) => `\\${c}`);
  return `LISTEN "${prefix}%`;
}

let adapterPool: Pool | null = null;

/** The adapter's pool, once `createSocketAdapter()` has built one. */
export function socketAdapterPool(): Pool | null {
  return adapterPool;
}

/**
 * Resolves once the adapter holds its subscription, or gives up quietly.
 *
 * The adapter checks out its `LISTEN` client asynchronously from its own
 * constructor and only releases it on close *if that checkout has finished* —
 * closing during the window in between strands the client, and `pool.end()`
 * then waits forever for a release that cannot come. Anything that may stop
 * the server moments after starting it has to wait this out first.
 */
export async function socketAdapterReady(timeoutMs = 5_000): Promise<void> {
  const pool = adapterPool;
  if (!pool) return;
  const like = listenPattern(process.env.DATABASE_URL);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { rowCount } = await pool.query(
        `SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND query LIKE $1 ESCAPE '\\' LIMIT 1`,
        [like]
      );
      if (rowCount) return;
    } catch {
      // The pool is not usable yet, or already closed. Either way there is
      // nothing to wait for that this loop can influence.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  logger.warn("Socket adapter subscription not established within its startup window");
}

/**
 * The Socket.IO adapter that carries broadcasts between server instances.
 *
 * Without one, `io.to(...)` reaches only the sockets held by the process that
 * called it — the room row is shared, so two players land in the same room and
 * are never told about each other.
 */
export function createSocketAdapter() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes("neon.tech")
      ? { rejectUnauthorized: false }
      : false,
    max: poolMax(),
    connectionTimeoutMillis: 5_000,
    // Never reap an idle client. The `LISTEN` client is checked out rather than
    // idle, so a timeout would not collect it today — but a pool that closes
    // connections underneath a subscription is one library change away from
    // dropping every broadcast in silence, and this pool is small enough that
    // holding its clients open costs nothing.
    idleTimeoutMillis: 0,
  });
  pool.on("error", (err) => logger.error({ err }, "Idle Postgres client error (socket adapter)"));
  adapterPool = pool;

  return createAdapter(pool, {
    channelPrefix: channelPrefix(process.env.DATABASE_URL),
    // Degrading to one-instance delivery is exactly the defect this adapter
    // exists to fix, and it degrades *silently* — the adapter's default
    // handler writes to `debug`, which is off. It took a live report to find
    // the first time.
    errorHandler: (err) =>
      logger.error(
        { err },
        "Socket.IO Postgres adapter error — broadcasts may not be reaching other instances"
      ),
  });
}
