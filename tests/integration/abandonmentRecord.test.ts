// tests/integration/abandonmentRecord.test.ts — #898: the matchmaking
// cooldown is gone, but the abandonment record it used to read is not. The
// penalty was removed; docs/GAME-RULES.md § Decisions still wants the fact kept, shown
// and served.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import type { GameMode } from "../../lib/game/gameEngine.ts";
import type { GameResult } from "../../lib/achievements.ts";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { register } from "../helpers/client.ts";
import { recordGameResult } from "../../server/game/stats.ts";

describe("the abandonment record", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    await server.stop();
  });

  const gameMode: GameMode = "free_for_all";

  /** Writes one recorded round for `userId`, `abandoned` as given. */
  async function recordRound(userId: string, abandoned: boolean, finishedAt: Date) {
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

  test("an abandoned round is recorded as such on its own row", async () => {
    const { user } = await register(server, "abandonrecord_flag_user");
    await recordRound(user.id, true, new Date());

    const res = await server.query<{ abandoned: boolean }>(
      "SELECT abandoned FROM round_history WHERE user_id = $1",
      [user.id]
    );
    assert.equal(res.length, 1);
    assert.equal(res[0]!.abandoned, true);
  });

  test("a played-out round is recorded as not abandoned", async () => {
    const { user } = await register(server, "abandonrecord_played_user");
    await recordRound(user.id, false, new Date());

    const res = await server.query<{ abandoned: boolean }>(
      "SELECT abandoned FROM round_history WHERE user_id = $1",
      [user.id]
    );
    assert.equal(res[0]!.abandoned, false);
  });

  test("the abandoned flag reaches GET /api/stats/history", async () => {
    const { user, cookie } = await register(server, "abandonrecord_history_user");
    await recordRound(user.id, true, new Date());

    const res = await fetch(`${server.url}/api/stats/history`, { headers: { cookie } });
    assert.equal(res.status, 200);
    const rows = (await res.json()) as { abandoned: boolean }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.abandoned, true, "the record must survive to the profile's own reader");
  });
});
