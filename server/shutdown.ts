import type { Server as HttpServer } from "node:http";
import type { Pool } from "pg";
import type { Server as SocketIOServer } from "socket.io";
import { logger } from "./logger.ts";
import { pool as appPool, QUERY_TIMEOUT_MS } from "./db.ts";
import { drainPool } from "./drainPool.ts";
import { beginShutdown } from "./socketTable.ts";
import { socketAdapterPool, socketAdapterReady } from "./socketAdapter.ts";

/**
 * Replit Cloud Run sends SIGTERM and SIGKILLs roughly ten seconds later. The
 * whole sequence below has to finish inside that window; a budget longer than
 * it buys nothing, because the platform kills the process first.
 */
export const PLATFORM_GRACE_MS = 10_000;

/**
 * The drain has to outlast one query's own timeout. A client stuck on a query
 * is not returned to the pool until `QUERY_TIMEOUT_MS` aborts it, so a shorter
 * window would report writes abandoned a moment before they land.
 */
export const DRAIN_TIMEOUT_MS = QUERY_TIMEOUT_MS + 1_000;

/**
 * Last resort. Strictly after the drain, so the ordinary path always reaches
 * exit(0) first, and strictly inside PLATFORM_GRACE_MS, so it can fire at all.
 */
export const FORCED_EXIT_MS = DRAIN_TIMEOUT_MS + 2_000;

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
 * Graceful shutdown for the Replit run path: disconnect every websocket, stop
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
    await socketAdapterReady(1_000);
    // Closes the adapter too, which releases the client parked on `LISTEN` and
    // stops its cleanup timer — so the pool below has nothing checked out.
    await io.close();
    const adapterPool = socketAdapterPool();
    if (adapterPool) {
      await adapterPool.end().catch((err) =>
        logger.error({ err }, "Socket adapter pool close failed")
      );
    }
    // Only reachable if `io` was never attached to this server.
    if (server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    // Disconnecting the sockets above starts writes — updateLastSeen, the
    // lobby teardown — and `handleGameOver` and `persistGameState` are
    // fire-and-forget, so nothing else holds a promise for any of them.
    // `pool.end()` makes every subsequent checkout fail, which would drop
    // exactly the stats, ladder and replay rows this shutdown exists to save.
    if (await drainPool(pool, { timeoutMs: DRAIN_TIMEOUT_MS })) {
      await pool.end();
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
    logger.info("Server shut down cleanly");
    exit(0);
  } catch (err) {
    logger.fatal({ err }, "Graceful shutdown failed");
    exit(1);
  } finally {
    clearTimeout(forceExit);
  }
}
