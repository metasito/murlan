// tests/integration/staleRoomPrune.test.ts — the stale-room prune asks the cluster, not this
// instance's memory, whether a room still holds a game.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";

describe("stale-room prune", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  let dbPool: pg.Pool;
  let pruneStaleRooms: () => Promise<number>;
  let maxAgeMs: number;

  before(async () => {
    server = await startTestServer();
    dbPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const retention = await import("../../server/game/retention.ts");
    pruneStaleRooms = retention.pruneStaleRooms;
    maxAgeMs = retention.STALE_ROOM_MAX_AGE_MS;
  });

  after(async () => {
    await dbPool.end();
    await server.stop();
  });

  async function seedRoom(code: string, ageMs: number): Promise<string> {
    const { rows } = await dbPool.query<{ id: string }>(
      `INSERT INTO rooms (code, status, game_mode, max_players, created_at)
       VALUES ($1, 'in_progress', 'free_for_all', 4, now() - make_interval(secs => $2))
       RETURNING id`,
      [code, ageMs / 1000]
    );
    return rows[0]!.id;
  }

  async function seedGame(roomId: string, touchedAgoMs: number) {
    await dbPool.query(
      `INSERT INTO active_games (room_id, game_state, updated_at)
       VALUES ($1, '{}'::jsonb, now() - make_interval(secs => $2))`,
      [roomId, touchedAgoMs / 1000]
    );
  }

  const exists = async (table: "rooms" | "active_games", column: "id" | "room_id", id: string) =>
    (await dbPool.query(`SELECT 1 FROM ${table} WHERE ${column} = $1`, [id])).rows.length > 0;

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
});
