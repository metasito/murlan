// tests/integration/roomVisibility.test.ts — which rooms quickmatch may enter.
//
// Two kinds of room, decided on #545: quick match makes a PUBLIC room that
// strangers are matched into, "create room" makes a PRIVATE one reachable only
// by its code. The property has to survive a restart, so these tests assert the
// outcome a second player observes rather than the bookkeeping that produces
// it — an in-memory register agrees with itself right up to the moment the
// process is replaced.
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
  players: { id: string }[];
}

describe("room visibility", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  const sockets: Socket[] = [];
  let n = 0;

  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    for (const s of sockets) s.emit("room:leave");
    await new Promise((r) => setTimeout(r, 200));
    for (const s of sockets) s.close();
    await server.stop();
  });

  /** A fresh account per caller: usernames are unique across the whole database. */
  async function player(tag: string) {
    const client = await connectAs(server, `vis_${tag}_${Date.now().toString(36)}_${n++}`);
    sockets.push(client.socket);
    return client;
  }

  async function quickmatch(client: { socket: Socket }, maxPlayers = 2) {
    const state = waitFor<RoomState>(client.socket, "room:state");
    client.socket.emit("room:quickmatch", { maxPlayers, gameMode: "free_for_all" });
    return state;
  }

  test("two players who quick-match into the same shape land in the same room", async () => {
    const first = await player("qm_a");
    const second = await player("qm_b");

    const a = await quickmatch(first);
    const b = await quickmatch(second);

    assert.equal(b.roomId, a.roomId, "the second quick-match must join the first, not open a rival room");
  });

  test("a room someone created is private: quick-match does not enter it", async () => {
    const host = await player("priv_host");
    const stranger = await player("priv_stranger");

    const made = waitFor<RoomState>(host.socket, "room:state");
    host.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
    const room = await made;

    const landed = await quickmatch(stranger);
    assert.notEqual(
      landed.roomId,
      room.roomId,
      "a private room must not take a stranger who never had its code"
    );
  });

  test("a created room is still reachable by its code", async () => {
    const host = await player("code_host");
    const guest = await player("code_guest");

    const made = waitFor<RoomState>(host.socket, "room:state");
    host.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
    const room = await made;

    const joined = waitFor<RoomState>(guest.socket, "room:state");
    guest.socket.emit("room:join", { code: room.code });
    const after = await joined;

    assert.equal(after.roomId, room.roomId, "private only means unlisted, never unreachable");
    assert.equal(after.players.length, 2, "the guest must be seated, not merely subscribed");
  });

  test("a waiting public room is discoverable from the database alone", async () => {
    // The defect underneath all of this: quick-match searched an in-memory Set
    // that only quick-match itself ever wrote to, so a restart or a second
    // process left a waiting public room unfindable while its row still said
    // "waiting". Discovery has to be a query, not a register.
    const opener = await player("db_public");
    const opened = await quickmatch(opener);

    const host = await player("db_private");
    const made = waitFor<RoomState>(host.socket, "room:state");
    host.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
    const privateRoom = await made;

    const { storage } = await import("../../server/storage.ts");
    const open = await storage.findWaitingPublicRooms();
    const ids = open.map((c) => c.room.id);

    assert.ok(ids.includes(opened.roomId), "a public room still waiting must be in the query's answer");
    assert.ok(!ids.includes(privateRoom.roomId), "a private room must never be in it");
  });

  test("a started room stops taking players before the hand exists, not after", async () => {
    // The window this closes: the roster is frozen when the game is built, so
    // a seat claimed between that moment and the status write belongs to
    // nobody — the straggler never receives game state and their row corrupts
    // the roster the next rematch rebuilds from.
    //
    // This asserts the outcome, not the window. The race is one round-trip
    // wide and closed by ordering rather than by a lock, so no deterministic
    // test can observe it; what this catches is the ordering being undone.
    const host = await player("start_host");
    const mate = await player("start_mate");

    const made = waitFor<RoomState>(host.socket, "room:state");
    host.socket.emit("room:quickmatch", { maxPlayers: 2, gameMode: "free_for_all" });
    const room = await made;

    const seated = waitFor<RoomState>(host.socket, "room:state");
    mate.socket.emit("room:join", { code: room.code });
    await seated;

    host.socket.emit("room:start");
    await waitFor(host.socket, "game:started");

    const { storage } = await import("../../server/storage.ts");
    const open = await storage.findWaitingPublicRooms();
    assert.ok(
      !open.some((c) => c.room.id === room.roomId),
      "a room whose hand has been dealt must not still be on quick-match's list"
    );
  });

  test("quick-match never seats anyone into a room nobody is in", async () => {
    // A public room whose closing write failed keeps status "waiting" with no
    // players, forever. Matching into it strands the arrival in a lobby whose
    // host has already gone.
    const opener = await player("orphan_opener");
    const opened = await quickmatch(opener);

    const { storage } = await import("../../server/storage.ts");
    await storage.removeRoomPlayer(opened.roomId, opener.user.id);

    const arrival = await player("orphan_arrival");
    const landed = await quickmatch(arrival);
    assert.notEqual(landed.roomId, opened.roomId, "an empty room is not a room to join");
  });

});
