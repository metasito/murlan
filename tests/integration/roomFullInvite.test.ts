// tests/integration/roomFullInvite.test.ts — a full room is not a finished one.
//
// The room a friend was invited to can stop being joinable without being over:
// strangers take the last seat, and take it back when one of them leaves. So
// the invitee has to be told on both edges, and the row has to survive both —
// an invite deleted when the lobby filled could not come back when it emptied.
//
// Only a real database can carry this. `/api/friends/invites` filters on the
// seat count, so it goes quiet the moment the room fills whether or not
// anything told the invitee at all: the rows are read here directly, and the
// notification is awaited on the invitee's own socket.
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
import { befriend, inviteRowsFor } from "../helpers/friends.ts";

interface RoomState {
  code: string;
  roomId: string;
}

interface JoinableEvent {
  roomCode: string;
  joinable: boolean;
}

describe(
  "a room that fills up tells its invitees without dropping their invites",
  { skip: hasDatabase() ? false : skipMessage() },
  () => {
    let server: TestServer;
    const sockets: Socket[] = [];
    let n = 0;

    before(async () => {
      server = await startTestServer();
    });
    after(async () => {
      for (const s of sockets) if (s.connected) s.close();
      await server.stop();
    });

    async function player(tag: string) {
      const c = await connectAs(server, `rf_${tag}_${Date.now().toString(36)}_${n++}`);
      sockets.push(c.socket);
      return c;
    }

    /** What the invitee's own screen would be offered. */
    async function offeredTo(cookie: string): Promise<{ roomCode: string }[]> {
      const res = await fetch(`${server.url}/api/friends/invites`, { headers: { cookie } });
      const text = await res.text();
      assert.equal(res.status, 200, `GET /api/friends/invites: ${text}`);
      return JSON.parse(text) as { roomCode: string }[];
    }

    test("the last seat going, and coming back, both reach the invitee", async () => {
      const host = await player("host");
      const friend = await player("friend");
      const stranger = await player("stranger");
      await befriend(server, host, friend);

      const made = waitFor<RoomState>(host.socket, "room:state");
      // Two seats: the host holds one, so a single stranger fills the room.
      host.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
      const room = await made;

      const invited = waitFor(friend.socket, "friend:invite");
      host.socket.emit("friend:invite", { friendUserId: friend.user.id, roomCode: room.code });
      await invited;
      assert.equal((await offeredTo(friend.cookie)).length, 1, "the invite is offered to start with");

      const filled = waitFor<JoinableEvent>(friend.socket, "friend:room_joinable");
      stranger.socket.emit("room:join", { code: room.code });
      const shut = await filled;
      assert.equal(shut.roomCode, room.code);
      assert.equal(shut.joinable, false, "the invitee is told the door is closed");

      assert.equal(
        (await inviteRowsFor(room.roomId)).length,
        1,
        "the invite row survives the room filling — a deleted one could not come back"
      );
      assert.equal(
        (await offeredTo(friend.cookie)).length,
        0,
        "and the endpoint stops offering it while there is no seat"
      );

      const freed = waitFor<JoinableEvent>(friend.socket, "friend:room_joinable");
      stranger.socket.emit("room:leave");
      const open = await freed;
      assert.equal(open.roomCode, room.code);
      assert.equal(open.joinable, true, "the invitee is told a seat came back");

      assert.equal((await inviteRowsFor(room.roomId)).length, 1, "the row is still untouched");
      assert.deepEqual(
        (await offeredTo(friend.cookie)).map((i) => i.roomCode),
        [room.code],
        "and the same invite is offered again"
      );
    });

    /**
     * The scenario #689 names is strangers filling a lobby, and a stranger
     * arrives by quickmatch rather than by code — they have no code to type.
     * That path seats a player through `claimRoomSeat` of its own, so the
     * announcement has to hang off the seating, not off `room:join`.
     */
    test("a stranger arriving by quickmatch closes the door just as loudly", async () => {
      const host = await player("qm_host");
      const friend = await player("qm_friend");
      const stranger = await player("qm_stranger");
      await befriend(server, host, friend);

      const made = waitFor<RoomState>(host.socket, "room:state");
      host.socket.emit("room:quickmatch", { gameMode: "free_for_all", maxPlayers: 2 });
      const room = await made;

      const invited = waitFor(friend.socket, "friend:invite");
      host.socket.emit("friend:invite", { friendUserId: friend.user.id, roomCode: room.code });
      await invited;

      const filled = waitFor<JoinableEvent>(friend.socket, "friend:room_joinable");
      stranger.socket.emit("room:quickmatch", { gameMode: "free_for_all", maxPlayers: 2 });
      const shut = await filled;
      assert.equal(shut.roomCode, room.code, "the stranger landed in the room, and it said so");
      assert.equal(shut.joinable, false);
      assert.equal((await inviteRowsFor(room.roomId)).length, 1, "the row survives here too");
    });
  }
);
