import type { Server as HttpServer } from "node:http";
import type { Pool } from "pg";
import type { SocketServer as SocketIOServer } from "../socket/socketTypes.ts";
import runtime from "../../deploy/runtime.json" with { type: "json" };
import { logger } from "./logger.ts";
import { pool as appPool, QUERY_TIMEOUT_MS } from "../store/db.ts";
import { drainPool } from "../store/drainPool.ts";
import { beginShutdown } from "../game/gameRoom.ts";
import { socketAdapterPool, socketAdapterReady } from "../socket/socketAdapter.ts";
import { closeOwnership } from "../game/gameOwnership.ts";
import { stopTables } from "../game/gamePersistence.ts";
import { settleDisconnects } from "../socket/socketPresence.ts";

/**
 * How long the host waits between SIGTERM and SIGKILL. The whole sequence
 * below has to finish inside that window; a budget longer than it buys
 * nothing, because the platform kills the process first.
 */
export const PLATFORM_GRACE_MS = runtime.sigtermGraceMs;

/**
 * The drain has to outlast one query's own timeout. A client stuck on a query
 * is not returned to the pool until `QUERY_TIMEOUT_MS` aborts it, so a shorter
 * window would report writes abandoned a moment before they land.
 */
export const DRAIN_TIMEOUT_MS = QUERY_TIMEOUT_MS + 800;

/** How long a departing player's seat has to reach the instance that owns their table. */
const DISCONNECT_SETTLE_MS = 1_500;

/**
 * The most each step of `shutdown` may take, in the order they run. Every step
 * is bounded by its entry, so their sum is the longest a shutdown can take.
 */
export const SHUTDOWN_BUDGET = {
  adapterReady: 750,
  ioClose: 500,
  settleDisconnects: DISCONNECT_SETTLE_MS,
  stopTables: 250,
  adapterPoolEnd: 250,
  drain: DRAIN_TIMEOUT_MS,
  poolEnd: 200,
  closeOwnership: 250,
} as const;

const SHUTDOWN_STEPS_MS = Object.values(SHUTDOWN_BUDGET).reduce((sum, ms) => sum + ms, 0);

/**
 * Last resort. Strictly after every step, so the ordinary path always reaches
 * exit(0) first, and strictly inside PLATFORM_GRACE_MS, so it can fire at all.
 */
export const FORCED_EXIT_MS = SHUTDOWN_STEPS_MS + 250;

/** Settles with `work`, or with nothing once `ms` has passed. */
export async function within<T>(ms: number, work: Promise<T>): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

export interface ShutdownDeps {
  io: SocketIOServer;
  server: HttpServer;
  /** Defaults to the app's module-singleton pool. */
  pool?: Pool;
  /** Defaults to `process.exit`. Injected so a test can observe the code. */
  exit?: (code: number) => void;
}

let shuttingDown = false;

/**
 * Graceful shutdown for the production run path: disconnect every websocket, stop
 * the http server, close the pool, exit 0.
 *
 * socket.io 4's `io.close()` does three things — it disconnects every socket,
 * closes the engine, and then calls `close()` on the http server it is
 * attached to, resolving only once that server's callback fires. So the http
 * server is closed by that one call and must not be closed a second time,
 * which would yield ERR_SERVER_NOT_RUNNING.
 */
export async function shutdown(
  signal: string,
  { io, server, pool = appPool, exit = (code) => process.exit(code) }: ShutdownDeps
): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Graceful shutdown initiated");

  const forceExit = setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    exit(1);
  }, FORCED_EXIT_MS);
  // The watchdog must not be the thing keeping the process alive. The project
  // types setTimeout as React Native's, which returns a bare number.
  (forceExit as unknown as { unref?: () => void }).unref?.();

  try {
    beginShutdown();
    // A SIGTERM arriving moments after boot would otherwise close the adapter
    // while it is still taking out its subscription, stranding that client so
    // the pool below never finishes closing.
    await socketAdapterReady(SHUTDOWN_BUDGET.adapterReady);
    // Closes the adapter too, which releases the client parked on `LISTEN` and
    // stops its cleanup timer — so the pool below has nothing checked out.
    await within(
      SHUTDOWN_BUDGET.ioClose,
      (async () => {
        await io.close();
        // Only reachable if `io` was never attached to this server.
        if (server.listening) {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      })()
    );
    await settleDisconnects(SHUTDOWN_BUDGET.settleDisconnects);
    await within(SHUTDOWN_BUDGET.stopTables, stopTables());
    const adapterPool = socketAdapterPool();
    if (adapterPool) {
      await within(
        SHUTDOWN_BUDGET.adapterPoolEnd,
        adapterPool.end().catch((err) => logger.error({ err }, "Socket adapter pool close failed"))
      );
    }
    // Disconnecting the sockets above starts writes — updateLastSeen, the
    // lobby teardown — and `handleRoundOver` and `persistGameState` are
    // fire-and-forget, so nothing else holds a promise for any of them.
    // `pool.end()` makes every subsequent checkout fail, which would drop
    // exactly the stats, ladder and replay rows this shutdown exists to save.
    if (await drainPool(pool, { timeoutMs: SHUTDOWN_BUDGET.drain })) {
      await within(
        SHUTDOWN_BUDGET.poolEnd,
        pool.end().catch((err) => logger.error({ err }, "Pool close failed"))
      );
    } else {
      logger.error(
        { busy: pool.totalCount - pool.idleCount, waiting: pool.waitingCount },
        "Postgres pool still busy after the drain window — in-flight writes are being abandoned"
      );
      // `pool.end()` resolves only once every checked-out client is released,
      // which a client the drain could not account for will not do inside the
      // remaining budget. Start the close, exit on our own terms, and let the
      // process teardown drop the sockets.
      void pool.end().catch((err) => logger.error({ err }, "Pool close failed"));
    }
    // After the drain, never before: the locks go with this connection, and a
    // table write still in flight once they are gone lands over the row of
    // whichever instance restored the table meanwhile.
    await within(SHUTDOWN_BUDGET.closeOwnership, closeOwnership());
    logger.info("Server shut down cleanly");
    exit(0);
  } catch (err) {
    logger.fatal({ err }, "Graceful shutdown failed");
    exit(1);
  } finally {
    clearTimeout(forceExit);
  }
}
