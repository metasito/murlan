// tests/integration/staleRoomPrune.test.ts — the stale-room prune asks the cluster, not this
// instance's memory, whether a room still holds a game.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { pruneStaleRooms, STALE_ROOM_MAX_AGE_MS as maxAgeMs } from "../../server/game/retention.ts";
import { activeGames as liveGames, type OnlineGameState } from "../../server/game/gameRoom.ts";

describe("stale-room prune", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    await server.stop();
  });

  async function seedRoom(code: string, ageMs: number): Promise<string> {
    const rows = await server.query<{ id: string }>(
      `INSERT INTO rooms (code, status, game_mode, max_players, created_at)
       VALUES ($1, 'in_progress', 'free_for_all', 4, now() - make_interval(secs => $2))
       RETURNING id`,
      [code, ageMs / 1000]
    );
    return rows[0]!.id;
  }

  async function seedGame(roomId: string, touchedAgoMs: number) {
    await server.query(
      `INSERT INTO active_games (room_id, game_state, updated_at)
       VALUES ($1, '{}'::jsonb, now() - make_interval(secs => $2))`,
      [roomId, touchedAgoMs / 1000]
    );
  }

  const exists = async (table: "rooms" | "active_games", column: "id" | "room_id", id: string) =>
    (await server.query(`SELECT 1 FROM ${table} WHERE ${column} = $1`, [id])).length > 0;

  test("an old room whose game another instance is still writing is kept", async () => {
    const held = await seedRoom("HELDRM", maxAgeMs * 2);
    await seedGame(held, maxAgeMs / 4);

    await pruneStaleRooms();

    assert.equal(await exists("rooms", "id", held), true, "the room another instance plays in stays");
    assert.equal(await exists("active_games", "room_id", held), true, "and so does its game");
  });

  test("an old room whose game nobody has touched within the window goes", async () => {
    const dead = await seedRoom("DEADRM", maxAgeMs * 2);
    await seedGame(dead, maxAgeMs * 2);

    assert.ok((await pruneStaleRooms()) >= 1);

    assert.equal(await exists("rooms", "id", dead), false);
    assert.equal(await exists("active_games", "room_id", dead), false);
  });

  test("an old room this instance is playing in is kept, though no row says so", async () => {
    const live = await seedRoom("LIVERM", maxAgeMs * 2);
    const dead = await seedRoom("GONERM", maxAgeMs * 2);
    liveGames.set(live, {} as OnlineGameState);
    try {
      assert.equal(await pruneStaleRooms(), 1);
    } finally {
      liveGames.delete(live);
    }

    assert.equal(await exists("rooms", "id", live), true);
    assert.equal(await exists("rooms", "id", dead), false);
    await server.query("DELETE FROM rooms WHERE id = $1", [live]);
  });

  test("a backlog past one call's cap is taken a capped call at a time", async () => {
    const backlog = 10_600;
    await server.query(
      `INSERT INTO rooms (code, status, game_mode, max_players, created_at)
       SELECT 'B' || lpad(g::text, 5, '0'), 'finished', 'free_for_all', 4, now() - make_interval(secs => $1)
       FROM generate_series(1, $2) AS g`,
      [(maxAgeMs * 2) / 1000, backlog]
    );
    const left = async () => Number((await server.query("SELECT count(*) AS n FROM rooms WHERE code LIKE 'B%'"))[0]!.n);

    assert.equal(await pruneStaleRooms(), 10_000, "twenty batches of 500, then the cap");
    assert.equal(await left(), backlog - 10_000);
    assert.equal(await pruneStaleRooms(), backlog - 10_000);
    assert.equal(await left(), 0);
  });
});
