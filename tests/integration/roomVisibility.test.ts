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

});
