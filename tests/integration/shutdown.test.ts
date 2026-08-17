import { test } from "node:test";
import assert from "node:assert/strict";
import { hasDatabase, skipMessage, startTestServer } from "../helpers/testServer.ts";
import { connectAs } from "../helpers/client.ts";

/**
 * Drives the real shutdown routine against a real booted server with a real
 * websocket attached — the only thing that proves the http server's close
 * callback actually fires while a socket is connected.
 *
 * This file boots one server and then ends the app's module-singleton pool, so
 * nothing else can go in it.
 */

/** The routine budgets 10s before it kills the process; anything near that is a hang. */
const PROMPT_MS = 3_000;

test(
  "shutdown() disconnects sockets, ends the pool and exits 0 promptly",
  { skip: hasDatabase() ? false : skipMessage() },
  async () => {
    const originalDatabaseUrl = process.env.DATABASE_URL!;
    const server = await startTestServer();

    // After boot, so these resolve the same module instances the running app
    // holds — server/db.ts builds its Pool from DATABASE_URL at import time.
    const { shutdown } = await import("../../server/shutdown.ts");
    const { pool } = await import("../../server/db.ts");

    const { socket } = await connectAs(server, `shutdown_${Date.now()}`);
    const disconnected = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("client never observed a disconnect")),
        PROMPT_MS
      );
      socket.once("disconnect", (reason) => {
        clearTimeout(timer);
        resolve(reason);
      });
    });

    const exitCodes: number[] = [];
    const startedAt = Date.now();
    await shutdown("SIGTERM", {
      io: server.io,
      server: server.httpServer,
      exit: (code) => exitCodes.push(code),
    });
    const elapsed = Date.now() - startedAt;

    assert.ok(
      elapsed < PROMPT_MS,
      `shutdown took ${elapsed}ms — it must not wait on connections that never end`
    );
    await disconnected;
    assert.equal(pool.ended, true, "the pool must be closed");
    assert.deepEqual(exitCodes, [0], "a graceful shutdown exits 0, exactly once");

    // A second signal must be a no-op rather than a second pool.end().
    await shutdown("SIGINT", {
      io: server.io,
      server: server.httpServer,
      exit: (code) => exitCodes.push(code),
    });
    assert.deepEqual(exitCodes, [0], "re-entering shutdown must do nothing");

    // stop() ends the same pool shutdown() just ended, so it throws — but its
    // own `finally` still drops the throwaway schema and restores DATABASE_URL,
    // which is the part this suite needs.
    await assert.rejects(
      () => server.stop(),
      /Called end on pool more than once/,
      "expected stop() to fail on the already-closed pool"
    );
    assert.equal(process.env.DATABASE_URL, originalDatabaseUrl);
  }
);
