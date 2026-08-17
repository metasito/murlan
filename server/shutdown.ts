import type { Server as HttpServer } from "node:http";
import type { Pool } from "pg";
import type { Server as SocketIOServer } from "socket.io";
import { logger } from "./logger.ts";
import { pool as appPool } from "./db.ts";
import { drainPool } from "./drainPool.ts";

/** How long the whole sequence gets before the process is killed anyway. */
const FORCED_EXIT_MS = 10_000;

/** Comfortably inside FORCED_EXIT_MS, so a stuck query still reaches the log. */
const DRAIN_TIMEOUT_MS = 5_000;

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
    await io.close();
    // Only reachable if `io` was never attached to this server.
    if (server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    // Disconnecting the sockets above starts writes — updateLastSeen, the
    // lobby teardown — and `handleGameOver` and `persistGameState` are
    // fire-and-forget, so nothing else holds a promise for any of them.
    // `pool.end()` makes every subsequent checkout fail, which would drop
    // exactly the stats, ladder and replay rows this shutdown exists to save.
    if (!(await drainPool(pool, { timeoutMs: DRAIN_TIMEOUT_MS }))) {
      logger.error(
        { busy: pool.totalCount - pool.idleCount, waiting: pool.waitingCount },
        "Postgres pool still busy after the drain window — in-flight writes are being abandoned"
      );
    }
    await pool.end();
    logger.info("Server shut down cleanly");
    exit(0);
  } catch (err) {
    logger.fatal({ err }, "Graceful shutdown failed");
    exit(1);
  } finally {
    clearTimeout(forceExit);
  }
}
