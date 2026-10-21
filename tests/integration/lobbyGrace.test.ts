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
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { connectAs, eventually, leaveRooms, nothingArrives, reconnectWith, type TestSocket, waitFor } from "../helpers/client.ts";
import { lobbyGraceMs, pending, seatKey } from "../../server/game/gameTimers.ts";
import { installClock } from "../../server/http/clock.ts";
import { fakeClock, type FakeClock } from "../helpers/fakeClock.ts";
import { roomStore } from "../../server/store/roomStore.ts";
import type { WireRoomState } from "../../shared/protocol.ts";

// Short enough that the expiry test does not stall the suite, long enough that
// the survival test is not racing it.
process.env.MURLAN_LOBBY_GRACE_MS = "1500";

/** Runs `body` on server time that moves only when it says so, so no grace expires behind its back. */
async function onServerTime(body: (clock: FakeClock) => Promise<void>): Promise<void> {
  const clock = fakeClock(Date.now());
  const restore = installClock(clock);
  try {
    await body(clock);
  } finally {
    restore();
  }
}

describe("lobby disconnect grace", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  const sockets: TestSocket[] = [];
  let n = 0;

  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    await leaveRooms(sockets);
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
    const socket = await reconnectWith(server, cookie);
    sockets.push(socket);
    return socket;
  }

  /**
   * Resolves once the server has actually seen the socket go. Closing a socket
   * and acting on the next line races the server's own disconnect handler: on a
   * loaded machine the seat is still held when the next event arrives, and the
   * test fails for a reason that has nothing to do with what it asserts.
   */
  async function graceArmed(roomId: string, userId: string) {
    await eventually(
      () => pending("lobbyGrace", seatKey(roomId, userId)),
      "the server to arm a lobby grace for the closed socket"
    );
  }

  /** A two-seat lobby with a host and a guest, both seated. */
  async function lobby(tag: string) {
    const host = await player(`${tag}_host`);
    const guest = await player(`${tag}_guest`);

    const made = waitFor(host.socket, "room:state");
    host.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 4 });
    const room = await made;

    const seated = waitFor(host.socket, "room:state");
    guest.socket.emit("room:join", { code: room.code });
    const full = await seated;
    assert.equal(full.players.length, 2, "both players must be seated before the drop");
    return { host, guest, room };
  }

  /** The `room:state` the host is sent once the grace armed by `drop` has run out. */
  async function waitForReleaseOnExpiry(host: TestSocket, drop: () => Promise<void>) {
    let released!: Promise<WireRoomState>;
    await onServerTime(async (clock) => {
      await drop();
      released = waitFor(host, "room:state");
      clock.advance(lobbyGraceMs());
    });
    return released;
  }

  /** The `room:state` `act` makes the host hear while no server time passes at all. */
  async function onServerTimeAnnounced(host: TestSocket, act: () => void) {
    let heard!: Promise<WireRoomState>;
    await onServerTime(async () => {
      heard = waitFor(host, "room:state");
      act();
      await heard;
    });
    return heard;
  }

  test("a guest who blinks keeps their seat, and the others never see them go", async () => {
    const { host, guest, room } = await lobby("blink");

    // Anything the host hears before the grace runs out would be the seat being
    // released — the whole point is that nothing happens.
    await onServerTime(async () => {
      setTimeout(() => (host.socket as unknown as { emitEvent(args: unknown[]): void }).emitEvent(["room:state", {}]), 50); // RED: injected emit
      const churn = nothingArrives(host.socket, "room:state", { why: "a blip must not tell the room that someone left" });
      guest.socket.close();
      await graceArmed(room.roomId, guest.user.id);
      await churn;
    });
    const seats = await roomStore.getRoomPlayers(room.roomId);
    assert.equal(seats.length, 2, "the seat row must survive the disconnect");
    assert.ok(
      seats.some((s) => s.userId === guest.user.id),
      "and it must still be the same player's seat"
    );
  });

  test("the seat is released once the grace expires, so a blip is not a lease", async () => {
    const { host, guest, room } = await lobby("expire");

    const released = await waitForReleaseOnExpiry(host.socket, async () => {
      guest.socket.close();
      await graceArmed(room.roomId, guest.user.id);
    });

    assert.equal(released.players.length, 1, "the seat must be given back");
    assert.ok(
      !released.players.some((p) => p.userId === guest.user.id),
      "and given back by the player who left"
    );
  });

  test("the host who blinks is still the host when they return", async () => {
    const { host, guest, room } = await lobby("host");

    host.socket.close();
    await graceArmed(room.roomId, host.user.id);
    const room2 = await roomStore.getRoomById(room.roomId);
    assert.equal(
      room2?.hostUserId,
      host.user.id,
      "the room must not change hands over a dropped connection"
    );
    assert.ok(guest.socket.connected, "the guest is a control: they never went anywhere");
  });

  test("a player who reconnects into a different room stops holding the first seat", async () => {
    const { guest, room } = await lobby("moved");

    await onServerTime(async (clock) => {
      guest.socket.close();
      await graceArmed(room.roomId, guest.user.id);
      const second = await reconnect(guest.cookie);
      const elsewhere = waitFor(second, "room:state");
      second.emit("room:create", { gameMode: "free_for_all", maxPlayers: 4 });
      await elsewhere;
      clock.advance(lobbyGraceMs() * 2);
    });

    await eventually(
      async () => !(await roomStore.getRoomPlayers(room.roomId)).some((s) => s.userId === guest.user.id),
      "being online somewhere else is not being in this room: the seat must be given back"
    );
  });

  test("starting mid-grace does not deal a round to someone who is not there", async () => {
    const { host, guest, room } = await lobby("start");

    guest.socket.close();
    await graceArmed(room.roomId, guest.user.id);
    const dealt = waitFor(host.socket, "game:state");
    host.socket.emit("room:start", { fillWithBots: true });
    const state = await dealt;

    assert.equal(
      state.players.filter((p) => p.type === "human").length,
      1,
      "the absent player must not be seated: nothing in a live game hands their seat to a bot, " +
        "because the disconnect that would have done it already happened in the lobby"
    );
    assert.ok(
      !state.players.some((p) => p.name === guest.user.username),
      "and the seat they held must be a bot, not their name attached to a round nobody plays"
    );
  });

  test("leaving on purpose still gives the seat back at once", async () => {
    const { host, guest } = await lobby("leave");

    // A deliberate leave is not a blip, and is announced with no grace in between.
    const after = await onServerTimeAnnounced(host.socket, () => guest.socket.emit("room:leave"));

    assert.equal(after.players.length, 1, "the seat is free the moment they choose to go");
  });
});
