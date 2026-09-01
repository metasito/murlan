// tests/integration/lobbyGrace.test.ts — a seat in a waiting lobby survives a blip.
//
// A live game holds a seat open through DISCONNECT_GRACE_MS. A lobby held one
// for no time at all: the room_players row was deleted on the disconnect, so a
// two-second drop while waiting for the room to fill unseated you, and the only
// route back read a per-process Map that a restart or a second instance empties.
//
// The seat row is the evidence. These tests assert what the other players in
// the room see, not the bookkeeping that produces it.
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
import { io as ioClient } from "socket.io-client";
import type { SanitizedState } from "../helpers/table.ts";

// Short enough that the expiry test does not stall the suite, long enough that
// the survival test is not racing it.
process.env.MURLAN_LOBBY_GRACE_MS = "1500";

/**
 * Resolves with the payload, or null if the window passes in silence.
 * `waitFor` throws on timeout, which cannot express "nothing should happen".
 */
function within<T>(socket: Socket, event: string, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

interface RoomState {
  code: string;
  roomId: string;
  hostUserId: string | null;
  players: { userId: string; seatIndex: number }[];
}

describe("lobby disconnect grace", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  const sockets: Socket[] = [];
  let n = 0;

  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    for (const s of sockets) if (s.connected) s.emit("room:leave");
    await new Promise((r) => setTimeout(r, 200));
    for (const s of sockets) s.close();
    await server.stop();
  });

  async function player(tag: string) {
    const c = await connectAs(server, `lg_${tag}_${Date.now().toString(36)}_${n++}`);
    sockets.push(c.socket);
    return c;
  }

  /** The same account back on a second socket, as the client's own retry does. */
  async function reconnect(cookie: string) {
    const res = await fetch(`${server.url}/api/auth/socket-ticket`, {
      method: "POST",
      headers: { cookie },
    });
    const { ticket } = (await res.json()) as { ticket: string };
    const socket = ioClient(server.url, {
      auth: { ticket },
      transports: ["websocket"],
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", reject);
    });
    return socket;
  }

  /**
   * Resolves once the server has actually seen the socket go. Closing a socket
   * and acting on the next line races the server's own disconnect handler: on a
   * loaded machine the seat is still held when the next event arrives, and the
   * test fails for a reason that has nothing to do with what it asserts.
   */
  async function graceArmed(roomId: string, userId: string) {
    const { lobbyGraceTimers, lobbyGraceKey } = await import("../../server/gameTimers.ts");
    for (let i = 0; i < 200; i++) {
      if (lobbyGraceTimers.has(lobbyGraceKey(roomId, userId))) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("the server never armed a lobby grace for the closed socket");
  }

  /** A two-seat lobby with a host and a guest, both seated. */
  async function lobby(tag: string) {
    const host = await player(`${tag}_host`);
    const guest = await player(`${tag}_guest`);

    const made = waitFor<RoomState>(host.socket, "room:state");
    host.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 4 });
    const room = await made;

    const seated = waitFor<RoomState>(host.socket, "room:state");
    guest.socket.emit("room:join", { code: room.code });
    const full = await seated;
    assert.equal(full.players.length, 2, "both players must be seated before the drop");
    return { host, guest, room };
  }

  test("a guest who blinks keeps their seat, and the others never see them go", async () => {
    const { host, guest, room } = await lobby("blink");

    // Anything the host hears in the next second would be the seat being
    // released — the whole point is that nothing happens.
    const churn = within<RoomState>(host.socket, "room:state", 1000);
    guest.socket.close();
    const heard = await churn;
    assert.equal(heard, null, "a blip must not tell the room that someone left");

    const { storage } = await import("../../server/storage.ts");
    const seats = await storage.getRoomPlayers(room.roomId);
    assert.equal(seats.length, 2, "the seat row must survive the disconnect");
    assert.ok(
      seats.some((s) => s.userId === guest.user.id),
      "and it must still be the same player's seat"
    );
  });

  test("the seat is released once the grace expires, so a blip is not a lease", async () => {
    const { host, guest } = await lobby("expire");

    guest.socket.close();
    const released = await within<RoomState>(host.socket, "room:state", 6000);

    assert.ok(released, "the room must be told when the grace runs out");
    assert.equal(released.players.length, 1, "the seat must be given back");
    assert.ok(
      !released.players.some((p) => p.userId === guest.user.id),
      "and given back by the player who left"
    );
  });

  test("the host who blinks is still the host when they return", async () => {
    const { host, guest, room } = await lobby("host");

    host.socket.close();
    await new Promise((r) => setTimeout(r, 300));

    const { storage } = await import("../../server/storage.ts");
    const room2 = await storage.getRoomById(room.roomId);
    assert.equal(
      room2?.hostUserId,
      host.user.id,
      "the room must not change hands over a dropped connection"
    );
    assert.ok(guest.socket.connected, "the guest is a control: they never went anywhere");
  });

  test("a player who reconnects into a different room stops holding the first seat", async () => {
    const { guest, room } = await lobby("moved");

    guest.socket.close();
    await graceArmed(room.roomId, guest.user.id);
    const second = await reconnect(guest.cookie);
    const elsewhere = waitFor<RoomState>(second, "room:state");
    second.emit("room:create", { gameMode: "free_for_all", maxPlayers: 4 });
    await elsewhere;

    await new Promise((r) => setTimeout(r, 3000));

    const { storage } = await import("../../server/storage.ts");
    const seats = await storage.getRoomPlayers(room.roomId);
    assert.ok(
      !seats.some((s) => s.userId === guest.user.id),
      "being online somewhere else is not being in this room: the seat must be given back"
    );
  });

  test("starting mid-grace does not deal a hand to someone who is not there", async () => {
    const { host, guest, room } = await lobby("start");

    guest.socket.close();
    await graceArmed(room.roomId, guest.user.id);
    const dealt = waitFor<SanitizedState>(host.socket, "game:state");
    host.socket.emit("room:start", { fillWithBots: true, botDifficulty: "easy" });
    const state = await dealt;

    assert.equal(
      state.players.filter((p) => p.type === "human").length,
      1,
      "the absent player must not be seated: nothing in a live game hands their seat to a bot, " +
        "because the disconnect that would have done it already happened in the lobby"
    );
    assert.ok(
      !state.players.some((p) => p.name === guest.user.username),
      "and the seat they held must be a bot, not their name attached to a hand nobody plays"
    );
  });

  test("leaving on purpose still gives the seat back at once", async () => {
    const { host, guest } = await lobby("leave");

    const left = within<RoomState>(host.socket, "room:state", 1500);
    guest.socket.emit("room:leave");
    const after = await left;

    assert.ok(after, "a deliberate leave is not a blip and must be announced immediately");
    assert.equal(after.players.length, 1, "the seat is free the moment they choose to go");
  });
});
