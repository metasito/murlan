import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import type { Socket } from "socket.io-client";
import { hasDatabase, skipMessage, startTestServer, type TestServer } from "../helpers/testServer.ts";
import { connectAs, waitFor } from "../helpers/client.ts";
import { boot, type Instance } from "../helpers/instance.ts";
import type { Client, RoomState, SanitizedState } from "../helpers/table.ts";

/**
 * A table owned by a spawned instance, played from this process's instance.
 * The shutdown test ends this process's pool, so it runs last.
 */
process.env.MURLAN_SWEEP_INTERVAL_MS = "500";

const OWNER_PORT = 5581;
const OWNER_BOT_DELAY_MS = 6_000;

describe("a table outlives losing its owner", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let local: TestServer;
  let observer: pg.Pool;
  let owner: Instance | undefined;
  const sockets: Socket[] = [];

  before(async () => {
    local = await startTestServer();
    observer = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  });

  after(async () => {
    for (const s of sockets) s.close();
    owner?.child.kill("SIGKILL");
    await observer.end().catch(() => {});
    await local.stop().catch(() => {});
  });

  async function openTable(tag: string, maxPlayers: number): Promise<{ host: Client; guest: Client; room: RoomState }> {
    owner = await boot(OWNER_PORT, process.env.DATABASE_URL!, {
      MURLAN_AFK_TIMEOUT_MS: "300",
      MURLAN_BOT_MOVE_DELAY_MS: String(OWNER_BOT_DELAY_MS),
    });
    const remote = { url: `http://127.0.0.1:${OWNER_PORT}` } as TestServer;
    const host = await connectAs(remote, `own_${tag}_h${Date.now() % 1e6}`);
    const guest = await connectAs(local, `own_${tag}_g${Date.now() % 1e6}`);
    sockets.push(host.socket, guest.socket);
    const created = waitFor<RoomState>(host.socket, "room:state");
    host.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers });
    const room = await created;
    const joined = waitFor<RoomState>(host.socket, "room:state");
    guest.socket.emit("room:join", { code: room.code });
    await joined;
    return { host, guest, room };
  }

  async function persisted(roomId: string): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const { rowCount } = await observer.query("SELECT 1 FROM active_games WHERE room_id = $1", [roomId]);
      if (rowCount) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.fail("the deal was never persisted");
  }

  test("a survivor resumes the table when its owner dies on a bot's turn", { timeout: 90_000 }, async () => {
    const { host, guest, room } = await openTable("bot", 3);
    const onBot = new Promise<void>((resolve) => {
      guest.socket.on("game:state", (s: SanitizedState) => {
        if (s.players[s.currentTurnIndex]?.type === "ai" && !s.gameOver) resolve();
      });
    });
    host.socket.emit("room:start", { fillWithBots: true });
    await onBot;
    await persisted(room.roomId);
    await new Promise((r) => setTimeout(r, 500));

    owner!.child.kill("SIGKILL");
    host.socket.close();
    guest.socket.removeAllListeners("game:state");
    await waitFor(guest.socket, "game:state", OWNER_BOT_DELAY_MS * 2);
  });

  test("a non-owner shutting down tells the owner its player left", { timeout: 60_000 }, async () => {
    const { shutdown } = await import("../../server/shutdown.ts");
    const { host, guest, room } = await openTable("sd", 2);
    const dealt = waitFor(guest.socket, "game:state", 15_000);
    host.socket.emit("room:start");
    await dealt;

    const told = waitFor<{ userId: string }>(host.socket, "game:player_disconnected", 15_000);
    await shutdown("SIGTERM", { io: local.io, server: local.httpServer, exit: () => {} });
    assert.equal((await told).userId, guest.user.id);
    const seat = await observer.query(
      "SELECT 1 FROM room_players WHERE room_id = $1 AND user_id = $2",
      [room.roomId, guest.user.id]
    );
    assert.equal(seat.rowCount, 1, "the departing instance released a seat at a table it does not own");
  });
});
