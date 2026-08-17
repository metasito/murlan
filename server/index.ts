const REQUIRED_ENV = ["SESSION_SECRET", "DATABASE_URL"];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) throw new Error(`Missing required secret: ${key}`);
}

import { logger } from "./logger.ts";
import { sessionMiddleware } from "./session.ts";
import { createApp } from "./testApp.ts";
import { shutdown } from "./shutdown.ts";
import { installProcessGuards } from "./socketSafety.ts";

export { sessionMiddleware };

// This file's sole job is binding the real PORT and installing process
// shutdown handlers for the Replit run path. Everything else — middleware,
// routes, sockets — lives in the `createApp()` factory in `./testApp.ts` so
// the integration test harness can boot the identical app on an ephemeral
// port against a throwaway database schema, without going through this
// file's listen()/SIGTERM/SIGINT wiring at all.
(async () => {
  const { server, io } = await createApp();

  const port = parseInt(process.env.PORT || "5000", 10);
  // reusePort is Linux-only; Windows and macOS reject it with ENOTSUP.
  const listenOpts = { port, host: "0.0.0.0", ...(process.platform === "linux" ? { reusePort: true } : {}) };
  server.listen(listenOpts, () => {
    logger.info(`express server serving on port ${port}`);
  });

  process.on("SIGTERM", () => void shutdown("SIGTERM", { io, server }));
  process.on("SIGINT", () => void shutdown("SIGINT", { io, server }));

  // After the app is up, so a failure during construction — `ensureSchema`
  // above all, which refuses to start on a schema it knows is wrong — reaches
  // the .catch below and exits, rather than being swallowed as an unhandled
  // rejection by the guard meant for the running server.
  installProcessGuards();
})().catch((err) => {
  logger.fatal({ err }, "Server failed to start");
  process.exit(1);
});
