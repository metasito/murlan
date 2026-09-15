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
import { befriend } from "../helpers/friends.ts";

interface RoomState {
  code: string;
  roomId: string;
  visibility: string;
  players: { seatIndex: number; userId: string }[];
  seatHolds: { seatIndex: number; username: string }[];
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

  async function quickmatch(
    client: { socket: Socket },
    maxPlayers = 2,
    gameMode = "free_for_all"
  ) {
    const state = waitFor<RoomState>(client.socket, "room:state");
    client.socket.emit("room:quickmatch", { maxPlayers, gameMode });
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

    const { roomStore } = await import("../../server/roomStore.ts");
    const open = await roomStore.findWaitingPublicRooms();
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

    const { roomStore } = await import("../../server/roomStore.ts");
    const open = await roomStore.findWaitingPublicRooms();
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

    const { roomStore } = await import("../../server/roomStore.ts");
    await roomStore.removeRoomPlayer(opened.roomId, opener.user.id);

    const arrival = await player("orphan_arrival");
    const landed = await quickmatch(arrival);
    assert.notEqual(landed.roomId, opened.roomId, "an empty room is not a room to join");
  });

  async function createRoom(client: { socket: Socket }, maxPlayers = 2, gameMode = "free_for_all") {
    const made = waitFor<RoomState>(client.socket, "room:state");
    client.socket.emit("room:create", { gameMode, maxPlayers });
    return made;
  }

  async function setVisibility(client: { socket: Socket }, visibility: "public" | "private") {
    const next = waitFor<RoomState>(client.socket, "room:state");
    client.socket.emit("room:setVisibility", { visibility });
    return next;
  }

  /**
   * Leaves `roomId` as the only room the matcher can pick, so an assertion
   * about which room a stranger landed in is about the flip under test and
   * not about which of several waiting rooms another case left behind first.
   */
  async function onlyPublicRoom(roomId: string) {
    const { roomStore } = await import("../../server/roomStore.ts");
    for (const rival of await roomStore.findWaitingPublicRooms()) {
      if (rival.room.id !== roomId) {
        await roomStore.updateRoomVisibility(rival.room.id, "private");
      }
    }
  }

  test("a host opens a private room to matchmaking and a stranger is seated into it", async () => {
    const host = await player("flip_host");
    const stranger = await player("flip_stranger");

    const room = await createRoom(host);
    const opened = await setVisibility(host, "public");
    assert.equal(opened.visibility, "public", "flipping the toggle on must make the room public");

    await onlyPublicRoom(room.roomId);

    const landed = await quickmatch(stranger);
    assert.equal(
      landed.roomId,
      room.roomId,
      "a room created private and opened later must be findable by the matcher"
    );
  });

  test("closing the room again shuts matchmaking back out", async () => {
    const host = await player("close_host");
    const stranger = await player("cl_stranger");

    const room = await createRoom(host);
    await setVisibility(host, "public");
    const closed = await setVisibility(host, "private");
    assert.equal(closed.visibility, "private", "the same control has to work both ways");

    const landed = await quickmatch(stranger);
    assert.notEqual(landed.roomId, room.roomId, "a closed room must not take a stranger");
  });

  test("every seated player is told the moment the room opens", async () => {
    const host = await player("tell_host");
    const mate = await player("tell_mate");

    const room = await createRoom(host, 4);
    const joined = waitFor<RoomState>(mate.socket, "room:state");
    mate.socket.emit("room:join", { code: room.code });
    await joined;

    const seenByMate = waitFor<RoomState>(mate.socket, "room:state");
    host.socket.emit("room:setVisibility", { visibility: "public" });
    assert.equal(
      (await seenByMate).visibility,
      "public",
      "becoming visible to strangers is a privacy transition, never silent"
    );
  });

  test("opening a room does not change what its code admits", async () => {
    const host = await player("oc_host");
    const holder = await player("oc_holder");

    const room = await createRoom(host, 4);
    await setVisibility(host, "public");

    const joined = waitFor<RoomState>(holder.socket, "room:state");
    holder.socket.emit("room:join", { code: room.code });
    const after = await joined;

    assert.equal(after.roomId, room.roomId);
    assert.equal(after.players.length, 2, "the code holder must be seated, not merely subscribed");
  });

  test("a seated player who is not the host cannot open the room", async () => {
    const host = await player("auth_host");
    const mate = await player("auth_mate");

    const room = await createRoom(host, 4);
    const joined = waitFor<RoomState>(mate.socket, "room:state");
    mate.socket.emit("room:join", { code: room.code });
    await joined;

    const refused = waitFor<{ code: string }>(mate.socket, "room:error");
    mate.socket.emit("room:setVisibility", { visibility: "public" });
    assert.equal((await refused).code, "NOT_HOST");

    const { roomStore } = await import("../../server/roomStore.ts");
    const row = await roomStore.getRoomById(room.roomId);
    assert.equal(row?.visibility, "private", "only the host decides who may see the room");
  });

  async function joinByCode(client: { socket: Socket }, code: string) {
    const joined = waitFor<RoomState>(client.socket, "room:state");
    client.socket.emit("room:join", { code });
    return joined;
  }

  // Teams, because a hold only exists on a table with sides: `heldSeats`
  // returns nothing at all for a free-for-all (docs/BRIEF.md §3.3), so the
  // same case written free-for-all would pass without a hold ever existing.
  async function teamsRoomHoldingASeat(tag: string) {
    const host = await player(`${tag}_host`);
    const friend = await player(`${tag}_friend`);
    await befriend(server, host, friend);

    const room = await createRoom(host, 4, "teams");
    const invited = waitFor<RoomState>(host.socket, "room:state");
    host.socket.emit("friend:invite", { friendUserId: friend.user.id, roomCode: room.code });
    const held = await invited;
    assert.equal(held.seatHolds.length, 1, "the invite row is the hold");

    return { host, room, held };
  }

  test("invite, open, and a stranger is seated beside the friend still expected", async () => {
    const { host, room } = await teamsRoomHoldingASeat("mix");
    const stranger = await player("mx_stranger");

    await setVisibility(host, "public");
    await onlyPublicRoom(room.roomId);

    const landed = await quickmatch(stranger, 4, "teams");
    assert.equal(landed.roomId, room.roomId, "an opened room with a free seat must take a stranger");

    const seat = landed.players.find((p) => p.userId === stranger.user.id);
    assert.ok(seat, "the stranger must be seated, not merely subscribed");
    assert.ok(
      !landed.seatHolds.some((h) => h.seatIndex === seat.seatIndex),
      "a stranger may take an open seat, never the one promised to the friend"
    );
    assert.equal(landed.seatHolds.length, 1, "the friend's hold outlives the stranger's arrival");
  });

  test("an opened room still holds the seat its invited friend was promised", async () => {
    const { host, room } = await teamsRoomHoldingASeat("held");
    const first = await player("held_first");
    const second = await player("held_second");
    const stranger = await player("hd_stranger");

    await joinByCode(first, room.code);
    const full = await joinByCode(second, room.code);
    assert.equal(full.players.length, 3, "three seated leaves exactly the held seat free");

    await setVisibility(host, "public");
    await onlyPublicRoom(room.roomId);

    const landed = await quickmatch(stranger, 4, "teams");
    assert.notEqual(
      landed.roomId,
      room.roomId,
      "the last seat is held for the invited friend, so the matcher has nowhere to sit"
    );
  });

  test("a three-seat room opened to matchmaking takes a stranger too", async () => {
    const host = await player("trio_host");
    const stranger = await player("trio_str");

    const room = await createRoom(host, 3);
    await setVisibility(host, "public");
    await onlyPublicRoom(room.roomId);

    const landed = await quickmatch(stranger, 3);
    assert.equal(
      landed.roomId,
      room.roomId,
      "the toggle opens every shape of room, not the four-seat table alone"
    );
  });

});
