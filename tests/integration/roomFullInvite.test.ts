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

    async function befriend(
      a: Awaited<ReturnType<typeof player>>,
      b: Awaited<ReturnType<typeof player>>
    ) {
      const add = await fetch(`${server.url}/api/friends/add`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: a.cookie },
        body: JSON.stringify({ username: b.user.username }),
      });
      assert.equal(add.status, 200, await add.text());
      const pending = await fetch(`${server.url}/api/friends/requests`, {
        headers: { cookie: b.cookie },
      });
      const rows = (await pending.json()) as { id: string }[];
      assert.equal(rows.length, 1, "the request reached the other account");
      const accept = await fetch(`${server.url}/api/friends/accept/${rows[0].id}`, {
        method: "POST",
        headers: { cookie: b.cookie },
      });
      assert.equal(accept.status, 200, await accept.text());
    }

    /** What the invitee's own screen would be offered. */
    async function offeredTo(cookie: string): Promise<{ roomCode: string }[]> {
      const res = await fetch(`${server.url}/api/friends/invites`, { headers: { cookie } });
      const text = await res.text();
      assert.equal(res.status, 200, `GET /api/friends/invites: ${text}`);
      return JSON.parse(text) as { roomCode: string }[];
    }

    /**
     * The rows themselves. The endpoint above answers nothing about them: its
     * seat-count filter goes empty on a full room with the notification and the
     * delete both absent, so reading it alone would pass on the bug.
     * Imported here rather than at module scope — `server/db.ts` builds its
     * pool as it loads, and `startTestServer` sets `DATABASE_URL` first.
     */
    async function inviteRowsFor(roomId: string): Promise<unknown[]> {
      const { db } = await import("../../server/db.ts");
      const { gameInvites } = await import("../../shared/schema.ts");
      const { eq } = await import("drizzle-orm");
      return db.select().from(gameInvites).where(eq(gameInvites.roomId, roomId));
    }

    test("the last seat going, and coming back, both reach the invitee", async () => {
      const host = await player("host");
      const friend = await player("friend");
      const stranger = await player("stranger");
      await befriend(host, friend);

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
  }
);
