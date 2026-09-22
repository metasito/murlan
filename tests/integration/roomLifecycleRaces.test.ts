// tests/integration/roomLifecycleRaces.test.ts — every room write that reads
// before it writes waits on the rooms row, so no two of them interleave.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { connectAs, register, waitFor } from "../helpers/client.ts";
import { holdRowLock } from "../helpers/userLock.ts";
import type { Client, RoomState, SanitizedState } from "../helpers/table.ts";

describe("room lifecycle races", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  let pool: pg.Pool;
  const clients: Client[] = [];
  let n = 0;

  before(async () => {
    server = await startTestServer();
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  });
  after(async () => {
    for (const c of clients) if (c.socket.connected) c.socket.close();
    await pool?.end();
    if (server) await server.stop();
  });

  async function players(count: number) {
    const made: Client[] = [];
    for (let i = 0; i < count; i++) {
      const c = await connectAs(server, `race_${n++}_${Date.now().toString(36)}`);
      clients.push(c);
      made.push(c);
    }
    return made;
  }

  async function lobby(seated: Client[], maxPlayers: number, gameMode = "free_for_all") {
    const [host, ...guests] = seated;
    const made = waitFor<RoomState>(host!.socket, "room:state");
    host!.socket.emit("room:create", { gameMode, maxPlayers });
    const room = await made;
    for (const g of guests) {
      const joined = waitFor<RoomState>(g.socket, "room:state");
      g.socket.emit("room:join", { code: room.code });
      await joined;
    }
    return room;
  }

  const lockRoom = (roomId: string) =>
    holdRowLock(pool, "SELECT id FROM rooms WHERE id = $1 FOR UPDATE", [roomId]);

  async function roomRow(roomId: string) {
    const { rows } = await pool.query<{ status: string; host_user_id: string }>(
      "SELECT status, host_user_id FROM rooms WHERE id = $1",
      [roomId]
    );
    return rows[0]!;
  }

  async function seats(roomId: string) {
    const { rows } = await pool.query<{ user_id: string; seat_index: number }>(
      "SELECT user_id, seat_index FROM room_players WHERE room_id = $1 ORDER BY seat_index",
      [roomId]
    );
    return rows.map((r) => [r.user_id, r.seat_index] as const);
  }

  async function until(check: () => Promise<boolean>, what: string) {
    const deadline = Date.now() + 5_000;
    while (!(await check())) {
      if (Date.now() > deadline) throw new Error(what);
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  test("149/120: a join queued ahead of the start is dealt a hand", async () => {
    const [host, a, late] = await players(3);
    const room = await lobby([host!, a!], 3);
    const lock = await lockRoom(room.roomId);
    try {
      late!.socket.emit("room:join", { code: room.code });
      await lock.waitForBlocked(1);
      host!.socket.emit("room:start");
      await lock.waitForBlocked(2);
    } finally {
      await lock.release();
    }
    const dealt = await waitFor<SanitizedState>(late!.socket, "game:state");
    assert.equal(dealt.players.length, 3);
  });

  test("178: a leave queued ahead of the start is not dealt a hand", async () => {
    const [host, a, leaver] = await players(3);
    const room = await lobby([host!, a!, leaver!], 3);
    const lock = await lockRoom(room.roomId);
    const dealt = waitFor<SanitizedState>(host!.socket, "game:state");
    try {
      leaver!.socket.emit("room:leave");
      await lock.waitForBlocked(1);
      host!.socket.emit("room:start");
      await lock.waitForBlocked(2);
    } finally {
      await lock.release();
    }
    assert.equal((await dealt).players.length, 2);
    assert.deepEqual(
      (await seats(room.roomId)).map(([u]) => u),
      [host!.user.id, a!.user.id]
    );
  });

  test("150: a join queued ahead of the last leave keeps the room, and hosts it", async () => {
    const [host, friend] = await players(2);
    const room = await lobby([host!], 3);
    const lock = await lockRoom(room.roomId);
    try {
      friend!.socket.emit("room:join", { code: room.code });
      await lock.waitForBlocked(1);
      host!.socket.emit("room:leave");
      await lock.waitForBlocked(2);
    } finally {
      await lock.release();
    }
    await until(
      async () => (await roomRow(room.roomId)).host_user_id === friend!.user.id,
      "the room is still hosted by the player who left"
    );
    assert.equal((await roomRow(room.roomId)).status, "waiting");
    assert.deepEqual(await seats(room.roomId), [[friend!.user.id, 1]]);
  });

  test("121: host and next seat leaving together pass the room to someone still seated", async () => {
    const [host, s1, s2] = await players(3);
    const room = await lobby([host!, s1!, s2!], 3);
    const lock = await lockRoom(room.roomId);
    try {
      host!.socket.emit("room:leave");
      await lock.waitForBlocked(1);
      s1!.socket.emit("room:leave");
      await lock.waitForBlocked(2);
    } finally {
      await lock.release();
    }
    await until(
      async () => (await seats(room.roomId)).length === 1,
      "both leaves never landed"
    );
    await until(
      async () => (await roomRow(room.roomId)).host_user_id === s2!.user.id,
      "the room is hosted by someone who left"
    );
  });

  test("180: a leave queued ahead of a join frees the seat the join takes", async () => {
    const [host, a, b] = await players(3);
    const room = await lobby([host!, a!], 2);
    const lock = await lockRoom(room.roomId);
    const outcome = Promise.race([
      waitFor<RoomState>(b!.socket, "room:state").then(() => "seated"),
      waitFor<{ code: string }>(b!.socket, "room:error").then((e) => e.code),
    ]);
    try {
      a!.socket.emit("room:leave");
      await lock.waitForBlocked(1);
      b!.socket.emit("room:join", { code: room.code });
      await lock.waitForBlocked(2);
    } finally {
      await lock.release();
    }
    assert.equal(await outcome, "seated");
  });

  async function quickmatchAfter(
    maxPlayers: number,
    meddle: (roomId: string, hostId: string) => Promise<void>
  ) {
    const [host, stranger] = await players(2);
    const opened = waitFor<RoomState>(host!.socket, "room:state");
    host!.socket.emit("room:quickmatch", { maxPlayers, gameMode: "free_for_all" });
    const room = await opened;

    const { roomStore } = await import("../../server/store/roomStore.ts");
    const real = roomStore.findWaitingPublicRooms;
    let meddled = 0;
    roomStore.findWaitingPublicRooms = async function (userId?: string) {
      const found = (await real.call(this, userId)).filter((c) => c.room.id === room.roomId);
      if (userId === stranger!.user.id && found.length > 0) {
        meddled += 1;
        await meddle(room.roomId, host!.user.id);
      }
      return found;
    };
    try {
      const landed = waitFor<RoomState>(stranger!.socket, "room:state");
      stranger!.socket.emit("room:quickmatch", { maxPlayers, gameMode: "free_for_all" });
      const state = await landed;
      assert.equal(meddled, 1, "the room never changed under the match — the test proved nothing");
      assert.notEqual(state.roomId, room.roomId);
    } finally {
      roomStore.findWaitingPublicRooms = real;
    }
  }

  test("176: quick-match does not seat a stranger in a room that just went private", () =>
    quickmatchAfter(3, async (roomId) => {
      await pool.query("UPDATE rooms SET visibility = 'private' WHERE id = $1", [roomId]);
    }));

  test("122: quick-match does not seat a stranger in a room that just emptied", () =>
    quickmatchAfter(4, async (roomId, hostId) => {
      await pool.query("DELETE FROM room_players WHERE room_id = $1 AND user_id = $2", [roomId, hostId]);
    }));

  test("177: a join broadcasts the host the room has now, not the one it read", async () => {
    const [host, a, b] = await players(3);
    const room = await lobby([host!, a!], 3);
    const { roomStore } = await import("../../server/store/roomStore.ts");
    const real = roomStore.getRoomByCode;
    let meddled = 0;
    roomStore.getRoomByCode = async function (code: string) {
      const read = await real.call(this, code);
      if (code === room.code && meddled++ === 0) {
        host!.socket.emit("room:leave");
        await until(
          async () => (await roomRow(room.roomId)).host_user_id === a!.user.id,
          "the host never left"
        );
      }
      return read;
    };
    try {
      const joined = waitFor<RoomState>(b!.socket, "room:state");
      b!.socket.emit("room:join", { code: room.code });
      assert.equal((await joined).hostUserId, a!.user.id);
      assert.equal(meddled, 1);
    } finally {
      roomStore.getRoomByCode = real;
    }
  });

  test("151: a seat left and reclaimed mid-hand keeps its row across a gap in the seats", async () => {
    const [host, gone, b, c] = await players(4);
    const room = await lobby([host!, gone!, b!, c!], 4);
    const left = waitFor(host!.socket, "room:state");
    gone!.socket.emit("room:leave");
    await left;

    const dealt = [host!, b!, c!].map((p) => waitFor<SanitizedState>(p.socket, "game:state"));
    host!.socket.emit("room:start");
    await Promise.all(dealt);

    const takeover = waitFor(host!.socket, "game:seat_bot_takeover");
    c!.socket.emit("room:leave");
    await takeover;
    const back = waitFor(host!.socket, "game:player_reconnected");
    c!.socket.emit("game:rejoin", { roomId: room.roomId });
    await back;

    assert.deepEqual(await seats(room.roomId), [
      [host!.user.id, 0],
      [b!.user.id, 1],
      [c!.user.id, 2],
    ]);
  });

  async function claimRace(gameMode: "free_for_all" | "teams", hold: boolean) {
    const [host, guest] = await players(2);
    const room = await lobby(hold ? [host!] : [host!, guest!], 4, gameMode);
    if (hold) {
      const { user: invitee } = await register(server, `race_inv_${n++}_${Date.now().toString(36)}`);
      await pool.query(
        "INSERT INTO game_invites (room_id, inviter_id, invitee_id) VALUES ($1, $2, $3)",
        [room.roomId, host!.user.id, invitee.id]
      );
    }
    // One more claimant than free seats, and no more: the app's pool holds four.
    const free = 2;
    const claimants = [];
    for (let i = 0; i < free + 1; i++) {
      claimants.push((await register(server, `race_cl_${n++}_${Date.now().toString(36)}`)).user.id);
    }

    const { roomStore } = await import("../../server/store/roomStore.ts");
    const lock = await lockRoom(room.roomId);
    let settled: Promise<PromiseSettledResult<Awaited<ReturnType<typeof roomStore.claimRoomSeat>>>[]>;
    try {
      settled = Promise.allSettled(claimants.map((id) => roomStore.claimRoomSeat(room.roomId, id)));
      await lock.waitForBlocked(claimants.length);
    } finally {
      await lock.release();
    }
    const results = await settled!;
    assert.deepEqual(results.filter((r) => r.status === "rejected"), []);
    const won = results.flatMap((r) => (r.status === "fulfilled" && r.value.ok ? [r.value.seatIndex] : []));
    assert.equal(won.length, free);
    assert.equal(new Set(won).size, free);
  }

  test("152/179: parallel claims take exactly the free seats", () => claimRace("free_for_all", false));
  test("152/179: parallel claims take exactly the seats a hold leaves free", () => claimRace("teams", true));

  test("049: a held persist does not land over the one after it", async () => {
    const [host, a] = await players(2);
    const room = await lobby([host!, a!], 2);
    const dealt = [host!, a!].map((p) => waitFor<SanitizedState>(p.socket, "game:state"));
    host!.socket.emit("room:start");
    await Promise.all(dealt);

    const { activeGames } = await import("../../server/game/gameRoom.ts");
    const { persistence, persistGameState } = await import("../../server/game/gamePersistence.ts");
    const game = activeGames.get(room.roomId)!;
    const real = persistence.writeActiveGame;
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    let held = 0;
    persistence.writeActiveGame = async function (roomId, state) {
      if (roomId === room.roomId && state.match.handsPlayed === 101) {
        held += 1;
        await gate;
      }
      return real.call(this, roomId, state);
    };
    try {
      game.handsPlayed = 101;
      const first = persistGameState(room.roomId, game);
      game.handsPlayed = 102;
      const second = persistGameState(room.roomId, game);
      await new Promise((r) => setTimeout(r, 200));
      open();
      await Promise.all([first, second]);
    } finally {
      persistence.writeActiveGame = real;
    }
    assert.equal(held, 1);
    const { rows } = await pool.query<{ game_state: { match: { handsPlayed: number } } }>(
      "SELECT game_state FROM active_games WHERE room_id = $1",
      [room.roomId]
    );
    assert.equal(rows[0]!.game_state.match.handsPlayed, 102);
  });
});
