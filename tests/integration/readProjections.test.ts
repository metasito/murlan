// tests/integration/readProjections.test.ts — each store read fetches only the
// columns its callers use, checked on the SQL it actually sends.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { connectAs, waitFor } from "../helpers/client.ts";
import { pool } from "../../server/store/db.ts";
import { friendStore } from "../../server/store/friendStore.ts";
import { roomStore } from "../../server/store/roomStore.ts";
import { activeGameStore } from "../../server/store/activeGameStore.ts";
import { GAME_SCHEMA_VERSION, OLDEST_GAME_SCHEMA_VERSION } from "../../shared/persistedEnvelope.ts";

async function collect(ids: AsyncIterable<string>, max = Infinity): Promise<string[]> {
  const out: string[] = [];
  for await (const id of ids) {
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

describe("store reads select only what their callers use", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  let restoreQuery: () => void;
  let captured: string[] | null = null;

  before(async () => {
    server = await startTestServer();
    const p = pool();
    const real = p.query.bind(p) as (...args: unknown[]) => Promise<unknown>;
    const patched = p as unknown as { query: (...args: unknown[]) => Promise<unknown> };
    patched.query = (...args: unknown[]) => {
      const q = args[0] as string | { text: string };
      captured?.push(typeof q === "string" ? q : q.text);
      return real(...args);
    };
    restoreQuery = () => {
      patched.query = real;
    };
  });
  after(async () => {
    restoreQuery?.();
    await server?.stop();
  });

  async function sqlOf<T>(read: () => Promise<T>): Promise<{ sql: string; result: T }> {
    captured = [];
    try {
      const result = await read();
      assert.ok(captured.length > 0, "the read sent no SQL through the pool: the capture is not looking");
      return { sql: captured.join(" ;; "), result };
    } finally {
      captured = null;
    }
  }

  async function user(name: string): Promise<string> {
    const [row] = await server.query<{ id: string }>(
      `INSERT INTO users (username, password, friend_code, email, last_seen)
       VALUES ($1, '$2b$10$aHashThatMustNeverLeaveTheDatabase', upper(substr(md5($1), 1, 6)), $1 || '@example.com', now())
       RETURNING id`,
      [name]
    );
    return row!.id;
  }

  test("friend lists and requests never select the password hash or the email", async () => {
    const [me, friend, asker, asked] = await Promise.all(["rp_me", "rp_friend", "rp_asker", "rp_asked"].map(user));
    await server.query(
      `INSERT INTO friends (user_id, friend_user_id, status) VALUES
        ($1, $2, 'accepted'), ($2, $1, 'accepted'), ($3, $1, 'pending'), ($1, $4, 'pending')`,
      [me, friend, asker, asked]
    );

    const reads: Record<string, [() => Promise<unknown[]>, string, string]> = {
      getFriends: [() => friendStore.getFriends(me!), "friend", friend!],
      getPendingFriendRequests: [() => friendStore.getPendingFriendRequests(me!), "requester", asker!],
      getSentFriendRequests: [() => friendStore.getSentFriendRequests(me!), "recipient", asked!],
    };
    for (const [name, [read, side, otherId]] of Object.entries(reads)) {
      const { sql, result } = await sqlOf(read);
      assert.doesNotMatch(sql, /"password"/, `${name} selects the password hash: ${sql}`);
      assert.doesNotMatch(sql, /"email"/, `${name} selects the email: ${sql}`);
      assert.equal(result.length, 1, `${name} lost its row`);
      const row = result[0] as unknown as Record<string, Record<string, unknown>>;
      assert.deepEqual(Object.keys(row[side]!).sort(), ["id", "lastSeen", "username"], `${name}'s ${side}`);
      assert.equal(row[side]!.id, otherId);
      assert.ok(row[side]!.lastSeen instanceof Date, `${name}'s ${side} lost lastSeen`);
      assert.deepEqual(
        Object.keys(row).filter((k) => k !== side).sort(),
        ["createdAt", "friendUserId", "id", "status", "userId"],
        `${name}'s request columns`
      );
    }
  });

  test("quick match reads at most 20 rooms of the asked shape, oldest first, none the caller sits in", async () => {
    const caller = await user("rp_qm_caller");
    const seaters = await Promise.all([0, 1, 2, 3].map((i) => user(`rp_qm_seat${i}`)));
    const shapes = [
      ["free_for_all", 2],
      ["free_for_all", 3],
      ["free_for_all", 4],
      ["teams", 4],
      ["free_for_all", 4],
      ["free_for_all", 4],
    ] as const;
    type Fixture = { id: string; mode: string; max: number; seats: number; callerSeated: boolean; age: number; open: boolean };
    let widest = 0;
    const fixtures: Fixture[] = [];
    for (let i = 0; i < 170; i++) {
      const [mode, max] = shapes[i % shapes.length]!;
      const seats = Math.floor(i / shapes.length) % (max + 1);
      const fixture = {
        mode,
        max,
        seats,
        callerSeated: seats > 0 && i % 7 === 0,
        age: (i * 37) % 170,
        visibility: i < 150 || i % 4 === 0 ? "public" : "private",
        status: i < 150 || i % 4 === 2 ? "waiting" : "in_progress",
      };
      const [room] = await server.query<{ id: string }>(
        `INSERT INTO rooms (code, host_user_id, status, game_mode, max_players, visibility, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, timestamp '2026-01-01' + make_interval(secs => $7))
         RETURNING id`,
        [`Q${String(i).padStart(5, "0")}`, seaters[0], fixture.status, mode, max, fixture.visibility, 170 - fixture.age]
      );
      for (let seat = 0; seat < seats; seat++) {
        const who = fixture.callerSeated && seat === 0 ? caller : seaters[seat];
        await server.query("INSERT INTO room_players (room_id, user_id, seat_index) VALUES ($1, $2, $3)", [
          room!.id,
          who,
          seat,
        ]);
      }
      fixtures.push({ ...fixture, id: room!.id, open: fixture.visibility === "public" && fixture.status === "waiting" });
    }
    assert.equal(fixtures.filter((f) => f.open).length, 150, "the fixture is not 150 waiting public rooms");

    for (const [gameMode, maxPlayers] of shapes) {
      const want = { userId: caller, gameMode, maxPlayers };
      const { sql, result } = await sqlOf(() => collect(roomStore.findQuickMatchCandidates(want), 20));
      const expected = fixtures
        .filter((f) => f.open && f.mode === gameMode && f.max === maxPlayers)
        .filter((f) => f.seats > 0 && f.seats < f.max && !f.callerSeated)
        .sort((a, b) => b.age - a.age)
        .map((f) => f.id);
      assert.ok(expected.length > 0, `the fixture has no ${gameMode}/${maxPlayers} room to find`);
      assert.deepEqual(result, expected.slice(0, 20), `${gameMode}/${maxPlayers}`);
      assert.match(sql, /\blimit\b/i, "the candidate read is unbounded");
      assert.equal(sql.split(" ;; ").length, 1, "the first page read more than one page");
      assert.deepEqual(await collect(roomStore.findQuickMatchCandidates(want)), expected, `${gameMode}/${maxPlayers}, paged`);
      widest = Math.max(widest, expected.length);
    }
    assert.ok(widest > 20, "no shape has more than 20 candidates: the limit is not exercised");
  });

  test("quick match pages past a full page of rooms whose free seats are all held", async (t) => {
    await server.query("UPDATE rooms SET visibility = 'private' WHERE visibility = 'public' AND status = 'waiting'");
    const [north, east, invitedA, invitedB, waiting] = await Promise.all(
      ["rp_held_n", "rp_held_e", "rp_held_ia", "rp_held_ib", "rp_open_host"].map(user)
    );
    const room = async (code: string, ageS: number) => {
      const [row] = await server.query<{ id: string }>(
        `INSERT INTO rooms (code, host_user_id, status, game_mode, max_players, visibility, created_at)
         VALUES ($1, $2, 'waiting', 'teams', 4, 'public', now() - make_interval(secs => $3))
         RETURNING id`,
        [code, north, ageS]
      );
      return row!.id;
    };
    for (let i = 0; i < 20; i++) {
      const id = await room(`H${String(i).padStart(5, "0")}`, 600 - i);
      await server.query(
        "INSERT INTO room_players (room_id, user_id, seat_index) VALUES ($1, $2, 0), ($1, $3, 1)",
        [id, north, east]
      );
      await server.query(
        "INSERT INTO game_invites (room_id, inviter_id, invitee_id) VALUES ($1, $2, $4), ($1, $3, $5)",
        [id, north, east, invitedA, invitedB]
      );
    }
    const open = await room("OPEN01", 60);
    await server.query("INSERT INTO room_players (room_id, user_id, seat_index) VALUES ($1, $2, 0)", [open, waiting]);

    const arrival = await connectAs(server, `rp_arrival_${Date.now().toString(36)}`);
    t.after(() => arrival.socket.close());
    const landed = waitFor(arrival.socket, "room:state");
    arrival.socket.emit("room:quickmatch", { maxPlayers: 4, gameMode: "teams" });
    assert.equal((await landed).roomId, open, "quick match gave up behind 20 held rooms and opened its own");
    const seats = await server.query<{ room_id: string }>("SELECT room_id FROM room_players WHERE user_id = $1", [
      arrival.user.id,
    ]);
    assert.deepEqual(seats.map((r) => r.room_id), [open], "a held seat was given away");
  });

  test("the orphan sweep reads seat ids, never an envelope, and only of rows it could resume or owes a commit", async () => {
    const envelope = (schemaVersion: unknown, roundOver: unknown, playerMap: unknown, pendingResults?: unknown[]) => ({
      schemaVersion,
      joinCode: "AAAAAA",
      gameState: { roundOver, hands: [[{ id: "c1", suit: "hearts", rank: 3 }]] },
      match: { playerMap, scores: {} },
      ...(pendingResults ? { pendingResults } : {}),
    });
    const rows: [string, unknown][] = [
      ["live", envelope(GAME_SCHEMA_VERSION, false, { 2: "cara", 0: "ana", 1: "besi" })],
      ["oldest", envelope(OLDEST_GAME_SCHEMA_VERSION, false, { 0: "dren" })],
      ["with-move-log", envelope(11, false, { 0: "fana" })],
      ["seatless", envelope(GAME_SCHEMA_VERSION, false, {})],
      ["odd-seats", envelope(GAME_SCHEMA_VERSION, false, { 0: 7, x: "nobody", 1: "edi" })],
      ["map-not-object", envelope(GAME_SCHEMA_VERSION, false, ["ana"])],
      ["between-rounds", envelope(GAME_SCHEMA_VERSION, true, { 0: "ana" })],
      ["between-rounds-settled", envelope(GAME_SCHEMA_VERSION, true, { 0: "ana" }, [])],
      ["between-rounds-owed", envelope(GAME_SCHEMA_VERSION, true, { 0: "gent" }, [{ round: 1 }])],
      ["live-owed", envelope(GAME_SCHEMA_VERSION, false, { 0: "hana" }, [{ round: 1 }])],
      ["too-old", envelope(OLDEST_GAME_SCHEMA_VERSION - 1, false, { 0: "ana" })],
      ["too-new", envelope(GAME_SCHEMA_VERSION + 1, false, { 0: "ana" })],
      ["version-as-text", envelope(String(GAME_SCHEMA_VERSION), false, { 0: "ana" })],
      ["not-an-envelope", ["ana"]],
    ];
    for (const [roomId, state] of rows) {
      await server.query("INSERT INTO active_games (room_id, game_state) VALUES ($1, $2::jsonb)", [
        roomId,
        JSON.stringify(state),
      ]);
    }

    const { sql, result } = await sqlOf(() => activeGameStore.listResumable());
    assert.doesNotMatch(sql, /"game_state"\s*(,|from\b)/i, `the sweep's read projects whole envelopes: ${sql}`);
    assert.deepEqual(
      [...result].sort((a, b) => (a.roomId < b.roomId ? -1 : 1)),
      [
        { roomId: "between-rounds-owed", userIds: ["gent"], roundOver: true, pending: true },
        { roomId: "live", userIds: ["ana", "besi", "cara"], roundOver: false, pending: false },
        { roomId: "live-owed", userIds: ["hana"], roundOver: false, pending: true },
        { roomId: "map-not-object", userIds: [], roundOver: false, pending: false },
        { roomId: "odd-seats", userIds: ["edi"], roundOver: false, pending: false },
        { roomId: "oldest", userIds: ["dren"], roundOver: false, pending: false },
        { roomId: "seatless", userIds: [], roundOver: false, pending: false },
        { roomId: "with-move-log", userIds: ["fana"], roundOver: false, pending: false },
      ]
    );
  });
});
