// tests/integration/abandonedGames.test.ts — the rows a restart leaves behind.
//
// `active_games` rows are deleted by `disposeGame`, and every caller of it
// walks the in-memory `activeGames` map: a table finishing, the last human
// leaving, the disconnect grace expiring, the periodic sweep. A restart empties
// that map, so a game that was live when the process went down — and that
// nobody ever rejoins — is invisible to all of them and its row stays forever.
// On a host that sleeps, that is every sleep with a game open.
//
// Only a real database can exercise this, since the whole property is about a
// row outliving the process that made it.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";

describe("abandoned game rows", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  let dbPool: pg.Pool;
  let prune: () => Promise<number>;
  let maxAgeMs: number;

  before(async () => {
    server = await startTestServer();
    dbPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const { __testables } = await import("../../server/socket.ts");
    prune = __testables.pruneAbandonedGames;
    maxAgeMs = __testables.ABANDONED_GAME_MAX_AGE_MS;
  });

  after(async () => {
    await dbPool.end();
    await server.stop();
  });

  /** A row as `persistGameState` writes one, stamped at a chosen age. */
  async function seedGame(roomCode: string, ageMs: number) {
    await dbPool.query(
      `INSERT INTO active_games (room_code, game_state, player_ids, player_map, scores, updated_at)
       VALUES ($1, '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, now() - make_interval(secs => $2))`,
      [roomCode, ageMs / 1000]
    );
  }

  const exists = async (roomCode: string) =>
    (await dbPool.query("SELECT 1 FROM active_games WHERE room_code = $1", [roomCode]))
      .rows.length > 0;

  test("a row older than the cutoff goes, and a fresh one stays", async () => {
    // Comfortably either side of the threshold, so this does not turn on the
    // exact value — changing the constant must not make the test lie.
    await seedGame("STALE1", maxAgeMs * 2);
    await seedGame("FRESH1", maxAgeMs / 4);

    const removed = await prune();

    assert.ok(removed >= 1, "the prune reports what it deleted");
    assert.equal(await exists("STALE1"), false, "an abandoned row is removed");
    assert.equal(await exists("FRESH1"), true, "a game still being played is not");
  });

  // A live game refreshes updated_at on every single move (persistGameState
  // sets it in the upsert's `set` clause). If that ever stopped, this prune
  // would start deleting games out from under the people playing them, so the
  // test states the dependency rather than leaving it implied.
  test("a row touched just now is never a candidate", async () => {
    await seedGame("TOUCHED", 0);
    await prune();
    assert.equal(await exists("TOUCHED"), true);
  });

  test("pruning an empty table is not an error and reports nothing", async () => {
    await dbPool.query("DELETE FROM active_games");
    assert.equal(await prune(), 0);
  });
});
