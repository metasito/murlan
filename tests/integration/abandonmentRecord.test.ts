// tests/integration/abandonmentRecord.test.ts — #898: the matchmaking
// cooldown is gone, but the abandonment record it used to read is not. The
// penalty was removed; docs/BRIEF.md §3.1 still wants the fact kept, shown
// and served.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import type { GameMode } from "../../lib/gameEngine.ts";
import type { GameResult } from "../../lib/achievements.ts";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { register } from "../helpers/client.ts";

describe("the abandonment record", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  let dbPool: pg.Pool;

  before(async () => {
    server = await startTestServer();
    dbPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  });

  after(async () => {
    await dbPool.end();
    await server.stop();
  });

  const gameMode: GameMode = "free_for_all";

  /** Writes one recorded hand for `userId`, `abandoned` as given. */
  async function recordHand(userId: string, abandoned: boolean, finishedAt: Date) {
    const { recordGameResult } = await import("../../server/stats.ts");
    const result: GameResult = {
      userId,
      placement: abandoned ? 4 : 1,
      playerCount: 4,
      playedBomb: false,
      playedJoker: false,
      matchWon: false,
      opponentsFinished: 0,
      abandoned,
    };
    await recordGameResult([result], gameMode, finishedAt);
  }

  test("an abandoned hand is recorded as such on its own row", async () => {
    const { user } = await register(server, "abandonrecord_flag_user");
    await recordHand(user.id, true, new Date());

    const res = await dbPool.query<{ abandoned: boolean }>(
      "SELECT abandoned FROM match_history WHERE user_id = $1",
      [user.id]
    );
    assert.equal(res.rows.length, 1);
    assert.equal(res.rows[0]!.abandoned, true);
  });

  test("a played-out hand is recorded as not abandoned", async () => {
    const { user } = await register(server, "abandonrecord_played_user");
    await recordHand(user.id, false, new Date());

    const res = await dbPool.query<{ abandoned: boolean }>(
      "SELECT abandoned FROM match_history WHERE user_id = $1",
      [user.id]
    );
    assert.equal(res.rows[0]!.abandoned, false);
  });

  test("the abandoned flag reaches GET /api/stats/history", async () => {
    const { user, cookie } = await register(server, "abandonrecord_history_user");
    await recordHand(user.id, true, new Date());

    const res = await fetch(`${server.url}/api/stats/history`, { headers: { cookie } });
    assert.equal(res.status, 200);
    const rows = (await res.json()) as { abandoned: boolean }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.abandoned, true, "the record must survive to the profile's own reader");
  });
});
