// tests/integration/quickmatchAutoStart.test.ts — who starts a matchmade table
// (docs/GAME-RULES.md § Decisions). Strangers quick-match matched together never agreed
// that one of them would host, so the table deals itself once it is full; a
// room someone opened with "create room" still waits for that someone.
//
// Asserted from what a second client observes, not from the register that
// produced it: `rooms.auto_start` has to survive the process being replaced.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { connectAs, leaveRooms, nothingArrives, type TestSocket, waitFor } from "../helpers/client.ts";
import { installClock } from "../../server/http/clock.ts";
import { autoStartDelayMs } from "../../server/game/gameTimers.ts";
import { fakeClock } from "../helpers/fakeClock.ts";

describe("a matchmade table deals itself", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  const sockets: TestSocket[] = [];
  let n = 0;

  before(async () => {
    process.env.MURLAN_AUTOSTART_DELAY_MS = "150";
    server = await startTestServer();
  });
  after(async () => {
    delete process.env.MURLAN_AUTOSTART_DELAY_MS;
    await leaveRooms(sockets);
    for (const s of sockets) s.close();
    await server.stop();
  });

  async function player(tag: string) {
    const client = await connectAs(server, `as_${tag}_${Date.now().toString(36)}_${n++}`);
    sockets.push(client.socket);
    return client;
  }

  test("once quick-match fills it, with nobody asked to host", async () => {
    const first = await player("qm_first");
    const made = waitFor(first.socket, "room:state");
    first.socket.emit("room:quickmatch", { maxPlayers: 2, gameMode: "free_for_all" });
    await made;

    const second = await player("qm_second");
    const dealt = waitFor(first.socket, "game:started");
    second.socket.emit("room:quickmatch", { maxPlayers: 2, gameMode: "free_for_all" });

    await dealt;
  });

  test("but a room opened with create room still waits for its host", async () => {
    const host = await player("cr_host");
    const made = waitFor(host.socket, "room:state");
    host.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
    const room = await made;

    const guest = await player("cr_guest");
    // Server time from the room filling, so an auto-start it armed fires on the advance below.
    const clock = fakeClock(Date.now());
    const restore = installClock(clock);
    try {
      const seated = waitFor(host.socket, "room:state");
      guest.socket.emit("room:join", { code: room.code });
      const full = await seated;
      assert.equal(full.players.length, 2, "the guest must be seated for the room to be full");

      setTimeout(() => (host.socket as unknown as { emitEvent(args: unknown[]): void }).emitEvent(["game:started", {}]), 50); // RED: injected emit
      const quiet = nothingArrives(host.socket, "game:started", {
        why: "a room its host opened dealt itself — room:start is the host's to send",
      });
      clock.advance(autoStartDelayMs() * 10);
      await quiet;
    } finally {
      restore();
    }
  });
});
