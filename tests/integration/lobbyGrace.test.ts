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

// Short enough that the expiry test does not stall the suite, long enough that
// the survival test is not racing it. Read at module scope by gameTimers.ts.
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

  test("leaving on purpose still gives the seat back at once", async () => {
    const { host, guest } = await lobby("leave");

    const left = within<RoomState>(host.socket, "room:state", 1500);
    guest.socket.emit("room:leave");
    const after = await left;

    assert.ok(after, "a deliberate leave is not a blip and must be announced immediately");
    assert.equal(after.players.length, 1, "the seat is free the moment they choose to go");
  });
});
