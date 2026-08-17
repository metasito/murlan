const REQUIRED_ENV = ["SESSION_SECRET", "DATABASE_URL"];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) throw new Error(`Missing required secret: ${key}`);
}

import { logger } from "./logger.ts";
import { pool } from "./db.ts";
import { sessionMiddleware } from "./session.ts";
import { createApp } from "./testApp.ts";

export { sessionMiddleware };

// This file's sole job is binding the real PORT and installing process
// shutdown handlers for the Replit run path. Everything else — middleware,
// routes, sockets — lives in the `createApp()` factory in `./testApp.ts` so
// the integration test harness can boot the identical app on an ephemeral
// port against a throwaway database schema, without going through this
// file's listen()/SIGTERM/SIGINT wiring at all.
(async () => {
  const { server } = await createApp();

  const port = parseInt(process.env.PORT || "5000", 10);
  // reusePort is Linux-only; Windows and macOS reject it with ENOTSUP.
  const listenOpts = { port, host: "0.0.0.0", ...(process.platform === "linux" ? { reusePort: true } : {}) };
  server.listen(listenOpts, () => {
    logger.info(`express server serving on port ${port}`);
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Graceful shutdown initiated");
    server.close(async () => {
      await pool.end();
      logger.info("Server shut down cleanly");
      process.exit(0);
    });
    setTimeout(() => {
      logger.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10_000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
})();
