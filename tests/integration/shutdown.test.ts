import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { hasDatabase, skipMessage, startTestServer, type TestServer } from "../helpers/testServer.ts";
import { connectAs, waitFor } from "../helpers/client.ts";

/**
 * Drives the real shutdown routine against a real booted server with a real
 * websocket attached — the only thing that proves the http server's close
 * callback actually fires while a socket is connected, and that the writes the
 * disconnect itself triggers still reach Postgres.
 *
 * This file boots one server and then ends the app's module-singleton pool, so
 * nothing else can go in it.
 */

/** The routine budgets 10s before it kills the process; anything near that is a hang. */
const PROMPT_MS = 5_000;

describe("graceful shutdown", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  let observer: pg.Pool;

  before(async () => {
    server = await startTestServer();
    // Created while DATABASE_URL still points at the throwaway schema, and
    // independent of the app's pool so it survives the shutdown under test.
    observer = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  });

  after(async () => {
    await observer.end().catch(() => {});
    // stop() ends the same pool shutdown() already ended, so it throws — but
    // its own `finally` still drops the throwaway schema and restores
    // DATABASE_URL, which is what this hook is here for. Asserted rather than
    // swallowed so the day it stops throwing is not a silent pass.
    await assert.rejects(
      () => server.stop(),
      /Called end on pool more than once/,
      "expected stop() to fail on the pool shutdown() already closed"
    );
  });

  test("disconnects sockets, lets their writes land, ends the pool and exits 0", async () => {
    const { shutdown } = await import("../../server/shutdown.ts");
    const { pool } = await import("../../server/db.ts");

    const { socket, user } = await connectAs(server, `shutdown_${Date.now()}`);

    // A room with this one player in it. Its teardown on disconnect
    // (handleLeaveRoom_lobby) is four queries deep and only starts after
    // updateLastSeen has already resolved, so it is a write that provably had
    // not been issued when io.close() returned.
    const created = waitFor<{ roomId: string; code: string }>(socket, "room:state");
    socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
    const { roomId } = await created;

    const before = await observer.query<{ status: string; last_seen: Date | null }>(
      `SELECT r.status, u.last_seen FROM rooms r, users u WHERE r.id = $1 AND u.id = $2`,
      [roomId, user.id]
    );
    assert.equal(before.rows[0].status, "waiting");

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

    // Read after the pool is closed: whatever is in these rows now is what the
    // shutdown let through.
    const after = await observer.query<{ status: string; last_seen: Date | null }>(
      `SELECT r.status, u.last_seen FROM rooms r, users u WHERE r.id = $1 AND u.id = $2`,
      [roomId, user.id]
    );
    assert.equal(
      after.rows[0].status,
      "finished",
      "the lobby teardown the disconnect started must have reached Postgres before the pool closed"
    );
    assert.notEqual(
      after.rows[0].last_seen,
      before.rows[0].last_seen,
      "updateLastSeen must have reached Postgres before the pool closed"
    );
    const players = await observer.query(
      `SELECT 1 FROM room_players WHERE room_id = $1`,
      [roomId]
    );
    assert.equal(players.rowCount, 0, "the seat must have been released");

    // A second signal must be a no-op rather than a second pool.end().
    await shutdown("SIGINT", {
      io: server.io,
      server: server.httpServer,
      exit: (code) => exitCodes.push(code),
    });
    assert.deepEqual(exitCodes, [0], "re-entering shutdown must do nothing");
  });
});
