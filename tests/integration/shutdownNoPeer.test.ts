// tests/integration/shutdownNoPeer.test.ts — a shutdown with no live peer keeps its tables to the
// end, as before the hand-off: the lock goes with the process and the next one restores the row.
//
// One server shut down in-process, which cannot be undone, so nothing else can go in this file.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { connectAs, waitFor, type TestSocket } from "../helpers/client.ts";
import { hasDatabase, skipMessage, startTestServer, type TestServer } from "../helpers/testServer.ts";
import { shutdown } from "../../server/http/shutdown.ts";
import { ownershipKey } from "../../server/game/gameOwnership.ts";

describe("a shutdown with no live peer", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  let observer: pg.Pool;
  const sockets: TestSocket[] = [];

  before(async () => {
    server = await startTestServer();
    // The app's pool is what the shutdown ends; this one reads the lock and the row after it.
    observer = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  });

  after(async () => {
    for (const s of sockets) s.close();
    await observer.end().catch(() => {});
    await server.stop().catch(() => {});
  });

  test("tells every socket when to reconnect, releases the table and exits 0 inside the budget", { timeout: 60_000 }, async () => {
    const tag = Date.now() % 1e6;
    const host = await connectAs(server, `np_h${tag}`);
    const guest = await connectAs(server, `np_g${tag}`);
    sockets.push(host.socket, guest.socket);
    const created = waitFor(host.socket, "room:state");
    host.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
    const { roomId, code } = await created;
    const joined = waitFor(host.socket, "room:state");
    guest.socket.emit("room:join", { code });
    await joined;
    const dealt = waitFor(guest.socket, "game:state", 15_000);
    host.socket.emit("room:start", {});
    await dealt;

    const seen = sockets.map((socket) => {
      const events: string[] = [];
      socket.on("server:draining", () => events.push("server:draining"));
      socket.on("disconnect", () => events.push("disconnect"));
      return events;
    });
    const gone = Promise.all(sockets.map((s) => waitFor(s, "disconnect", 15_000)));
    const exits: number[] = [];
    await shutdown("SIGTERM", { io: server.io, server: server.httpServer, tables: server.rt, exit: (code) => exits.push(code) });
    await gone;

    // The watchdog exits 1 at FORCED_EXIT_MS through the same `exit`; only 0 means every step ran inside its budget.
    assert.deepEqual(exits, [0]);
    for (const events of seen) assert.deepEqual(events, ["server:draining", "disconnect"]);
    const key = BigInt.asUintN(64, BigInt(ownershipKey(roomId)));
    const lock = await observer.query(
      "SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = $1::bigint::oid AND objid = $2::bigint::oid",
      [String(key >> 32n), String(BigInt.asUintN(32, key))]
    );
    assert.equal(lock.rowCount, 0, "the table's lock outlived the process's shutdown");
    const row = await observer.query("SELECT 1 FROM active_games WHERE room_id = $1", [roomId]);
    assert.equal(row.rowCount, 1, "the next process has no row to restore the table from");
  });
});
