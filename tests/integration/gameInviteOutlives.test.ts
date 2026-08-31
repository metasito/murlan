// tests/integration/gameInviteOutlives.test.ts — an invite is a row, not a packet.
//
// `friend:invite` checked the two were friends and emitted. Nothing wrote it
// down: no table, no endpoint, no screen. So an invite that arrived while the
// recipient's socket was between connections was gone for good — the room sat
// `waiting` for someone who was never told, the inviter saw no failure, and the
// invitee had nowhere to look. A push notification was the only fallback, and a
// push can be off, dismissed, or on a device nobody is holding.
//
// Only a real database can carry this: the whole property is a row outliving
// the connection that would have announced it.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import type { Socket } from "socket.io-client";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { connectAs, reconnectWith, waitFor } from "../helpers/client.ts";

interface RoomState {
  code: string;
  roomId: string;
}

interface InviteRow {
  roomCode: string;
  fromUsername: string;
}

describe("a game invite outlives the socket that would have carried it", {
  skip: hasDatabase() ? false : skipMessage(),
}, () => {
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
    const c = await connectAs(server, `gi_${tag}_${Date.now().toString(36)}_${n++}`);
    sockets.push(c.socket);
    return c;
  }

  /** Makes the two accounts friends through the same endpoints a player uses. */
  async function befriend(a: Awaited<ReturnType<typeof player>>, b: Awaited<ReturnType<typeof player>>) {
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

  async function invitesFor(cookie: string): Promise<InviteRow[]> {
    const res = await fetch(`${server.url}/api/friends/invites`, { headers: { cookie } });
    // Read once: assert.equal evaluates its message eagerly, so `await
    // res.text()` inline would consume the stream on the passing path too.
    const text = await res.text();
    assert.equal(res.status, 200, `GET /api/friends/invites: ${text}`);
    return JSON.parse(text) as InviteRow[];
  }

  /**
   * The rows themselves, not the endpoint's answer. `/api/friends/invites`
   * filters on the room still being joinable, so it goes empty the moment the
   * room closes whether or not anything deleted anything — reading it alone
   * would pass with the delete removed. Imported here rather than at module
   * scope: `server/db.ts` builds its pool as it loads, and `startTestServer`
   * sets `DATABASE_URL` first.
   */
  async function inviteRowsFor(roomId: string): Promise<unknown[]> {
    const { db } = await import("../../server/db.ts");
    const { gameInvites } = await import("../../shared/schema.ts");
    const { eq } = await import("drizzle-orm");
    return db.select().from(gameInvites).where(eq(gameInvites.roomId, roomId));
  }

  /** A host with a waiting room, and a friend who is not connected to hear about it. */
  async function hostAndAbsentFriend(tag: string) {
    const host = await player(`${tag}_host`);
    const friend = await player(`${tag}_friend`);
    await befriend(host, friend);

    const made = waitFor<RoomState>(host.socket, "room:state");
    host.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 4 });
    const room = await made;

    // The whole point: nobody is listening when the invite is sent.
    friend.socket.close();
    await new Promise((r) => setTimeout(r, 150));
    return { host, friend, room };
  }

  test("an invite sent while the friend has no socket is waiting for them", async () => {
    const { host, friend, room } = await hostAndAbsentFriend("offline");

    host.socket.emit("friend:invite", {
      friendUserId: friend.user.id,
      roomCode: room.code,
    });
    await new Promise((r) => setTimeout(r, 400));

    const rows = await invitesFor(friend.cookie);
    assert.equal(
      rows.length,
      1,
      "the invite reached nothing that outlives the socket, so there is nowhere to see it"
    );
    assert.equal(rows[0]?.roomCode, room.code);
    assert.equal(rows[0]?.fromUsername, host.user.username);
  });

  /**
   * A retried emit and an impatient host are the same event to the database.
   * The unique constraint is what makes the second one an update rather than a
   * second row in the invitee's list.
   */
  test("inviting the same friend to the same room twice leaves one invite", async () => {
    const { host, friend, room } = await hostAndAbsentFriend("twice");

    for (let i = 0; i < 3; i++) {
      host.socket.emit("friend:invite", {
        friendUserId: friend.user.id,
        roomCode: room.code,
      });
      await new Promise((r) => setTimeout(r, 120));
    }
    await new Promise((r) => setTimeout(r, 300));

    assert.equal((await invitesFor(friend.cookie)).length, 1);
  });

  /**
   * Expiry is the room's status, not a clock. A room that has started cannot be
   * joined, so an invite to it must not be offered — however many rows exist.
   */
  test("an invite stops being offered once the room has started", async () => {
    const { host, friend, room } = await hostAndAbsentFriend("started");

    host.socket.emit("friend:invite", {
      friendUserId: friend.user.id,
      roomCode: room.code,
    });
    await new Promise((r) => setTimeout(r, 400));
    assert.equal((await invitesFor(friend.cookie)).length, 1, "waiting room, invite stands");

    host.socket.emit("room:start", { fillWithBots: true, botDifficulty: "easy" });
    await new Promise((r) => setTimeout(r, 800));

    assert.deepEqual(
      await invitesFor(friend.cookie),
      [],
      "the room can no longer be joined, so the invite must not be offered"
    );
  });

  /**
   * `waiting` is not the same as joinable. `claimRoomSeat` refuses a full room
   * with `full`, which is a different answer from `not_waiting` — so a room
   * nobody has started can still have no seat left, and offering an invite to
   * it sends the player at a door that will not open.
   */
  test("an invite to a room that has filled up is not offered", async () => {
    const host = await player("full_host");
    const friend = await player("full_friend");
    await befriend(host, friend);

    const made = waitFor<RoomState>(host.socket, "room:state");
    host.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
    const room = await made;

    host.socket.emit("friend:invite", { friendUserId: friend.user.id, roomCode: room.code });
    await new Promise((r) => setTimeout(r, 400));
    assert.equal((await invitesFor(friend.cookie)).length, 1, "one seat free, invite stands");

    // Someone else takes the last seat. Nobody has pressed start, so the room
    // is still `waiting`.
    const filler = await player("full_filler");
    const seated = waitFor<RoomState>(host.socket, "room:state");
    filler.socket.emit("room:join", { code: room.code });
    await seated;

    assert.deepEqual(
      await invitesFor(friend.cookie),
      [],
      "the room is full, so the invite leads to a door that will not open"
    );
  });

  /**
   * Server authority: the room code arrives from the client, and the client is
   * not the thing that decides whether the sender is at that table. Without
   * this, any account could invite any friend into any waiting room whose code
   * it could name, including a stranger's.
   */
  test("a player who holds no seat in the room cannot invite into it", async () => {
    const host = await player("outsider_host");
    const outsider = await player("outsider_sender");
    const friend = await player("outsider_friend");
    await befriend(outsider, friend);

    const made = waitFor<RoomState>(host.socket, "room:state");
    host.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 4 });
    const room = await made;

    // The outsider knows the code but has never sat down in it.
    outsider.socket.emit("friend:invite", {
      friendUserId: friend.user.id,
      roomCode: room.code,
    });
    await new Promise((r) => setTimeout(r, 400));

    assert.deepEqual(await invitesFor(friend.cookie), []);
  });

  /**
   * An invite is a pointer to a room, so it must not outlive one.
   *
   * The host leaves, the lobby empties, and the room closes without ever
   * starting. The read filters on `waiting`, so the endpoint stops offering it
   * — but the invitee is not in that room and hears nothing, and their list is
   * cached with `staleTime: Infinity`, so the banner sat on their home screen
   * pointing at a room that no longer existed.
   *
   * Two halves, and the row is only the first: the invitee has to be *told*,
   * on the one channel that reaches an account which is not in the room.
   */
  test("an invite does not outlive the room it points at", async () => {
    const { host, friend, room } = await hostAndAbsentFriend("closed");

    host.socket.emit("friend:invite", {
      friendUserId: friend.user.id,
      roomCode: room.code,
    });
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(
      (await invitesFor(friend.cookie)).length,
      1,
      "nothing to test: the invite was never written"
    );

    // Back on their socket, so there is something listening when the room dies.
    const back = await reconnectWith(server, friend.cookie);
    sockets.push(back);
    const told = waitFor<{ roomCode: string }>(back, "friend:invite_retired");

    host.socket.emit("room:leave", { roomId: room.roomId });

    const payload = await told;
    assert.equal(payload.roomCode, room.code, "the invitee was told about the wrong room");
    assert.deepEqual(
      await inviteRowsFor(room.roomId),
      [],
      "the row outlived the room it points at"
    );
    assert.deepEqual(
      await invitesFor(friend.cookie),
      [],
      "the invite is still being offered"
    );
  });

  /**
   * An invite to somebody who is not a friend is refused, and refusing it must
   * not write a row — the authorisation check is the only thing standing
   * between this table and an unauthenticated write primitive.
   */
  test("a stranger's invite writes nothing", async () => {
    const host = await player("stranger_host");
    const stranger = await player("stranger_other");

    const made = waitFor<RoomState>(host.socket, "room:state");
    host.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 4 });
    const room = await made;

    host.socket.emit("friend:invite", {
      friendUserId: stranger.user.id,
      roomCode: room.code,
    });
    await new Promise((r) => setTimeout(r, 400));

    assert.deepEqual(await invitesFor(stranger.cookie), []);
  });
});
