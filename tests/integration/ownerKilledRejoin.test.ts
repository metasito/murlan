// tests/integration/ownerKilledRejoin.test.ts — a player whose table's owner was killed gets the
// table back on the first rejoin, from this instance, with no sweep to wake it.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import type { Socket } from "socket.io-client";
import { hasDatabase, skipMessage, startTestServer, type TestServer } from "../helpers/testServer.ts";
import { connectAs, eventually, waitFor, type TestSocket } from "../helpers/client.ts";
import { boot, stopInstance, type Instance } from "../helpers/instance.ts";
import { CLOCK_CEILING_MS } from "../../shared/clock.ts";

// Off: the rejoin alone must take the table over.
process.env.MURLAN_SWEEP_INTERVAL_MS = "3600000";

/** One silent 1.5 s try to the dead owner, the claim and the restore, and the socket hops. */
const REJOINED_WITHIN_MS = 3_000;

describe("a rejoin after the table's owner was killed", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let local: TestServer;
  let observer: pg.Pool;
  let owner: Instance | undefined;
  const sockets: TestSocket[] = [];

  before(async () => {
    local = await startTestServer();
    // Its own pool: it reads the row the owner's deal wrote.
    observer = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  });

  after(async () => {
    for (const s of sockets) s.close();
    owner?.child.kill("SIGKILL");
    await observer.end().catch(() => {});
    await local.stop().catch(() => {});
  });

  test("is answered with the table inside one try and the restore", { timeout: 90_000 }, async () => {
    owner = await boot(process.env.DATABASE_URL!, { MURLAN_AFK_TIMEOUT_MS: String(CLOCK_CEILING_MS) });
    const tag = Date.now() % 1e6;
    const host = await connectAs({ url: `http://127.0.0.1:${owner.port}` } as TestServer, `okr_h${tag}`);
    const guest = await connectAs(local, `okr_g${tag}`);
    sockets.push(host.socket, guest.socket);
    const created = waitFor(host.socket, "room:state");
    host.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
    const room = await created;
    const joined = waitFor(host.socket, "room:state");
    guest.socket.emit("room:join", { code: room.code });
    await joined;
    const dealt = waitFor(guest.socket, "game:state", 15_000);
    host.socket.emit("room:start", {});
    await dealt;
    await eventually(
      async () => (await observer.query("SELECT 1 FROM active_games WHERE room_id = $1", [room.roomId])).rowCount,
      "the deal to be persisted",
      10_000
    );

    await stopInstance(owner.child);
    const reply = await (guest.socket as unknown as Socket)
      .timeout(REJOINED_WITHIN_MS)
      .emitWithAck("game:rejoin", { roomId: room.roomId });
    assert.deepEqual(reply, { ok: true });
  });
});
