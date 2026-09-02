// tests/integration/seatHold.test.ts — the seat a friend is invited into is
// held for them, on the inviter's own side, and it stops being held.
//
// Driven through the real socket server and a real database, because the whole
// claim is about what `claimRoomSeat` does under its row lock with the invite
// rows beside it: a test of the pure allocator cannot say whether anything
// reads them, and the room's own broadcast is where the lobby learns of a hold.
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
import { teamForSeat, TEAMS_PLAYER_COUNT } from "../../lib/gameEngine.ts";

interface RoomState {
  code: string;
  roomId: string;
  players: { seatIndex: number; userId: string; username: string }[];
  seatHolds: { seatIndex: number; username: string; expiresInMs: number }[];
}

interface RoomError {
  code: string;
  message: string;
}

const sideOf = (seatIndex: number) =>
  teamForSeat(seatIndex, TEAMS_PLAYER_COUNT, "teams");

describe(
  "a seat held for an invited friend",
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
      delete process.env.MURLAN_SEAT_HOLD_MS;
    });

    async function player(tag: string) {
      const c = await connectAs(server, `sh_${tag}_${Date.now().toString(36)}_${n++}`);
      sockets.push(c.socket);
      return c;
    }

    /** A four-seat teams room with the host in seat 0, and one invite out. */
    async function roomWithAnInvite(tag: string) {
      const host = await player(`${tag}_host`);
      const friend = await player(`${tag}_friend`);
      await befriend(server, host, friend);

      const made = waitFor<RoomState>(host.socket, "room:state");
      host.socket.emit("room:create", { gameMode: "teams", maxPlayers: TEAMS_PLAYER_COUNT });
      const room = await made;

      const heard = waitFor<RoomState>(host.socket, "room:state");
      host.socket.emit("friend:invite", {
        friendUserId: friend.user.id,
        roomCode: room.code,
      });
      return { host, friend, room, held: await heard };
    }

    async function joins(who: { socket: Socket }, code: string, watcher: Socket) {
      const seated = waitFor<RoomState>(watcher, "room:state");
      who.socket.emit("room:join", { code });
      return seated;
    }

    test("is the seat opposite the inviter, and strangers are seated around it", async () => {
      const { host, friend, room, held } = await roomWithAnInvite("teams");

      assert.deepEqual(
        held.seatHolds.map((h) => h.seatIndex),
        [2],
        "the room says which seat is held the moment the invite is written"
      );
      assert.equal(held.seatHolds[0]?.username, friend.user.username, "and who it is held for");
      assert.ok(
        (held.seatHolds[0]?.expiresInMs ?? 0) > 0,
        "with a hold that has not already run out"
      );

      const strangerA = await player("teams_sA");
      const afterA = await joins(strangerA, room.code, host.socket);
      assert.equal(
        afterA.players.find((p) => p.userId === strangerA.user.id)?.seatIndex,
        1
      );

      const strangerB = await player("teams_sB");
      const afterB = await joins(strangerB, room.code, host.socket);
      const seatB = afterB.players.find((p) => p.userId === strangerB.user.id)?.seatIndex;
      assert.equal(
        seatB,
        3,
        "seat 2 is the lowest free one and the second stranger must not be given it"
      );

      const afterFriend = await joins(friend, room.code, host.socket);
      const seatOfHost = afterFriend.players.find((p) => p.userId === host.user.id)?.seatIndex;
      const seatOfFriend = afterFriend.players.find((p) => p.userId === friend.user.id)?.seatIndex;
      assert.equal(seatOfFriend, 2, "the friend arrives into the seat that was waiting");
      assert.equal(
        sideOf(seatOfHost!),
        sideOf(seatOfFriend!),
        "which is the whole ticket: the two friends are partners, not opponents"
      );
      assert.notEqual(sideOf(seatOfFriend!), sideOf(1), "and the strangers are the other pair");
      assert.deepEqual(afterFriend.seatHolds, [], "nothing is held once they have arrived");
    });

    test("expires, and the seat it was holding goes to whoever is next", async () => {
      const { host, room } = await roomWithAnInvite("expiry");

      const strangerA = await player("expiry_sA");
      await joins(strangerA, room.code, host.socket);
      const strangerB = await player("expiry_sB");
      await joins(strangerB, room.code, host.socket);

      const latecomer = await player("expiry_late");
      const refused = waitFor<RoomError>(latecomer.socket, "room:error");
      latecomer.socket.emit("room:join", { code: room.code });
      assert.equal(
        (await refused).code,
        "SEAT_HELD",
        "the last seat is held, and the server says so rather than seating them"
      );

      // The same account, the same room, the same last seat: only the length of
      // the hold changes, so nothing but its expiry can explain the difference.
      process.env.MURLAN_SEAT_HOLD_MS = "1";
      await new Promise((resolve) => setTimeout(resolve, 5));
      try {
        const seated = await joins(latecomer, room.code, host.socket);
        assert.equal(
          seated.players.find((p) => p.userId === latecomer.user.id)?.seatIndex,
          2,
          "once the hold has run out the seat is anyone's"
        );
        assert.deepEqual(seated.seatHolds, [], "and the room stops promising it");
      } finally {
        delete process.env.MURLAN_SEAT_HOLD_MS;
      }
    });

    test("is not taken out of a free-for-all lobby", async () => {
      const host = await player("ffa_host");
      const friend = await player("ffa_friend");
      await befriend(server, host, friend);

      const made = waitFor<RoomState>(host.socket, "room:state");
      host.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
      const room = await made;

      const heard = waitFor<RoomState>(host.socket, "room:state");
      host.socket.emit("friend:invite", { friendUserId: friend.user.id, roomCode: room.code });
      assert.deepEqual((await heard).seatHolds, [], "there is no side to hold a seat on");

      const stranger = await player("ffa_stranger");
      const seated = await joins(stranger, room.code, host.socket);
      assert.equal(
        seated.players.find((p) => p.userId === stranger.user.id)?.seatIndex,
        1,
        "so the last seat still goes to whoever asks for it"
      );
    });
  }
);
