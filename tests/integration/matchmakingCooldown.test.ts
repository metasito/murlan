// tests/integration/matchmakingCooldown.test.ts — #858: an abandoned hand is
// recorded on the row that already exists for it, and enough of them in a
// row gates `room:quickmatch` rather than costing any more rating.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import type { GameMode } from "../../lib/gameEngine.ts";
import type { GameResult } from "../../lib/achievements.ts";
import { ABANDON_COOLDOWN_THRESHOLD } from "../../lib/abandonCooldown.ts";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { connectAs, waitFor, register } from "../helpers/client.ts";
import type { RoomState } from "../helpers/gameDriver.ts";

describe("matchmaking cooldown", { skip: hasDatabase() ? false : skipMessage() }, () => {
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
    const { user } = await register(server, "cooldown_flag_user");
    await recordHand(user.id, true, new Date());

    const res = await dbPool.query<{ abandoned: boolean }>(
      "SELECT abandoned FROM match_history WHERE user_id = $1",
      [user.id]
    );
    assert.equal(res.rows.length, 1);
    assert.equal(res.rows[0]!.abandoned, true);
  });

  test("a played-out hand is recorded as not abandoned", async () => {
    const { user } = await register(server, "cooldown_played_user");
    await recordHand(user.id, false, new Date());

    const res = await dbPool.query<{ abandoned: boolean }>(
      "SELECT abandoned FROM match_history WHERE user_id = $1",
      [user.id]
    );
    assert.equal(res.rows[0]!.abandoned, false);
  });

  test("one short of the threshold does not gate quickmatch — a habit is not one drop", async () => {
    const alice = await connectAs(server, "cooldown_under");
    try {
      for (let i = 0; i < ABANDON_COOLDOWN_THRESHOLD - 1; i++) {
        await recordHand(alice.user.id, true, new Date());
      }

      const admitted = waitFor<RoomState>(alice.socket, "room:state");
      alice.socket.emit("room:quickmatch", { maxPlayers: 4, gameMode });
      const room = await admitted;
      assert.ok(room.roomId, "still let in — under the threshold");
    } finally {
      alice.socket.close();
    }
  });

  test("crossing the threshold gates quickmatch, with no rating consequence attached", async () => {
    const bob = await connectAs(server, "cooldown_over");
    try {
      for (let i = 0; i < ABANDON_COOLDOWN_THRESHOLD; i++) {
        await recordHand(bob.user.id, true, new Date());
      }

      const refused = waitFor<{ code?: string; params?: { minutes?: number } }>(
        bob.socket,
        "room:error"
      );
      bob.socket.emit("room:quickmatch", { maxPlayers: 4, gameMode });
      const payload = await refused;
      assert.equal(payload.code, "MATCHMAKING_COOLDOWN");
      assert.ok(
        typeof payload.params?.minutes === "number" && payload.params.minutes > 0,
        "the refusal names when the cooldown ends"
      );
    } finally {
      bob.socket.close();
    }
  });
});
