// tests/integration/quickmatchAutoStart.test.ts — who starts a matchmade table
// (docs/GAME-RULES.md § Decisions). Strangers quick-match matched together never agreed
// that one of them would host, so the table deals itself once it is full; a
// room someone opened with "create room" still waits for that someone.
//
// Asserted from what a second client observes, not from the register that
// produced it: `rooms.auto_start` has to survive the process being replaced.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import type { Socket } from "socket.io-client";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { connectAs, waitFor } from "../helpers/client.ts";

interface RoomState {
  code: string;
  roomId: string;
  players: { seatIndex: number; userId: string }[];
}

/** Long enough for the deal to have arrived if it was ever going to. */
const OBSERVE_MS = 2_000;

describe("a matchmade table deals itself", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  const sockets: Socket[] = [];
  let n = 0;

  before(async () => {
    process.env.MURLAN_AUTOSTART_DELAY_MS = "150";
    server = await startTestServer();
  });
  after(async () => {
    delete process.env.MURLAN_AUTOSTART_DELAY_MS;
    for (const s of sockets) s.emit("room:leave");
    await new Promise((r) => setTimeout(r, 200));
    for (const s of sockets) s.close();
    await server.stop();
  });

  async function player(tag: string) {
    const client = await connectAs(server, `as_${tag}_${Date.now().toString(36)}_${n++}`);
    sockets.push(client.socket);
    return client;
  }

  function neverDeals(socket: Socket) {
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(true), OBSERVE_MS);
      socket.once("game:started", () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
  }

  test("once quick-match fills it, with nobody asked to host", async () => {
    const first = await player("qm_first");
    const made = waitFor<RoomState>(first.socket, "room:state");
    first.socket.emit("room:quickmatch", { maxPlayers: 2, gameMode: "free_for_all" });
    await made;

    const second = await player("qm_second");
    const dealt = waitFor(first.socket, "game:started");
    second.socket.emit("room:quickmatch", { maxPlayers: 2, gameMode: "free_for_all" });

    await dealt;
  });

  test("but a room opened with create room still waits for its host", async () => {
    const host = await player("cr_host");
    const made = waitFor<RoomState>(host.socket, "room:state");
    host.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
    const room = await made;

    const guest = await player("cr_guest");
    const seated = waitFor<RoomState>(host.socket, "room:state");
    guest.socket.emit("room:join", { code: room.code });
    const full = await seated;
    assert.equal(full.players.length, 2, "the guest must be seated for the room to be full");

    assert.ok(
      await neverDeals(host.socket),
      "a room its host opened dealt itself — room:start is the host's to send"
    );
  });
});
