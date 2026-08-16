// tests/integration/ladderAndReplay.test.ts — what the game-over path writes
// for the ranked ladder and for match replay.
//
// Both writes are fire-and-forget from `handleGameOver`, both go to tables that
// were added after the app shipped, and neither had ever executed before this
// suite existed: the unit tests cover the arithmetic, and nothing covered the
// SQL. The two properties that actually matter here are things a unit test
// structurally cannot reach — that a replay never contains a hand, and that a
// bot seat never reaches the ladder.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { connectAs, waitFor } from "../helpers/client.ts";
import { driveHumansToGameOver, waitForRow, type RoomState } from "../helpers/gameDriver.ts";
import { START_RATING, seasonKey } from "../../lib/rating.ts";
import type { ReplayMove, ReplaySeat } from "../../lib/replay.ts";

// Same convention as the other integration suites: an exchange phase left to
// the AFK path must not stall the run.
process.env.MURLAN_AFK_TIMEOUT_MS = "300";
process.env.MURLAN_DISCONNECT_GRACE_MS = "500";

describe("ladder and replay writes", { skip: hasDatabase() ? false : skipMessage() }, () => {
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

  /** Two humans plus a bot, played to the end of one hand. */
  async function playOneHand(prefix: string) {
    const alice = await connectAs(server, `${prefix}_alice`);
    const bob = await connectAs(server, `${prefix}_bob`);

    const created = waitFor<RoomState>(alice.socket, "room:state");
    alice.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 3 });
    const room = await created;

    const joined = waitFor<RoomState>(bob.socket, "room:state");
    bob.socket.emit("room:join", { code: room.code });
    await joined;

    await driveHumansToGameOver([alice.socket, bob.socket], () => {
      alice.socket.emit("room:start", { fillWithBots: true, botPersonality: "luan" });
    });

    return { alice, bob, room };
  }

  test("a finished hand is stored as a replay, and the replay holds no hand", async () => {
    const { alice, bob } = await playOneHand("rep");
    try {
      const row = await waitForRow(async () => {
        const res = await dbPool.query(
          "SELECT player_ids, seats, moves, rankings, game_mode FROM match_replays WHERE player_ids @> $1::jsonb",
          [JSON.stringify([alice.user.id])]
        );
        return res.rows[0] ?? null;
      });

      const seats = row.seats as ReplaySeat[];
      const moves = row.moves as ReplayMove[];
      const playerIds = row.player_ids as string[];

      assert.equal(row.game_mode, "free_for_all");
      assert.equal(seats.length, 3, "every seat is recorded, bot included");
      assert.ok(moves.length > 0, "a played hand produces moves");

      // The whole privacy premise of the feature: a replay records what was
      // played, never what was held. If a `hand` key ever appears here, the
      // feature has silently become something else.
      const serialised = JSON.stringify(moves);
      assert.doesNotMatch(serialised, /"hand"/, "a move must never carry a hand");
      for (const move of moves) {
        assert.deepEqual(
          Object.keys(move).sort(),
          ["combo", "handCounts", "seat"],
          "a move is exactly a seat, what it played, and the counts that followed"
        );
        assert.equal(move.handCounts.length, 3);
      }

      // Only the humans can open it. A bot seat has no account to read it with,
      // and putting its synthetic id here would break the ownership filter.
      assert.deepEqual([...playerIds].sort(), [alice.user.id, bob.user.id].sort());
      assert.equal(seats.filter((s) => s.userId === null).length, 1, "the bot seat is userId null");

      assert.ok((row.rankings as string[]).length > 0);
    } finally {
      alice.socket.close();
      bob.socket.close();
    }
  });

  test("a rated hand moves both humans and never creates a row for a bot", async () => {
    const { alice, bob } = await playOneHand("lad");
    try {
      const season = seasonKey(new Date());

      for (const { user } of [alice, bob]) {
        const row = await waitForRow(async () => {
          const res = await dbPool.query(
            "SELECT rating, games, season FROM user_ratings WHERE user_id = $1",
            [user.id]
          );
          return res.rows[0] ?? null;
        });
        assert.equal(row.season, season, "the row lands in the month it was played");
        assert.equal(Number(row.games), 1);
        assert.notEqual(
          Number(row.rating),
          START_RATING,
          "a finished hand must actually move the rating"
        );
      }

      // The bot seat carries a synthetic `bot:<seat>` id with no users row, so
      // a write for it would violate the foreign key rather than fail quietly.
      // Both human rows above have landed, so the write has had its chance.
      const botRows = await dbPool.query(
        "SELECT 1 FROM user_ratings WHERE user_id LIKE 'bot:%'"
      );
      assert.equal(botRows.rows.length, 0, "a bot seat must never reach the ladder");
    } finally {
      alice.socket.close();
      bob.socket.close();
    }
  });

  test("the two humans' rating changes cancel out", async () => {
    const { alice, bob } = await playOneHand("cons");
    try {
      const ratings = await waitForRow(async () => {
        const res = await dbPool.query(
          "SELECT user_id, rating, games FROM user_ratings WHERE user_id = ANY($1)",
          [[alice.user.id, bob.user.id]]
        );
        return res.rows.length === 2 ? res.rows : null;
      });

      // Both accounts are brand new, so they share a K — which is the condition
      // under which lib/rating.ts guarantees exact conservation.
      const total = ratings.reduce(
        (sum: number, r: { rating: number }) => sum + (Number(r.rating) - START_RATING),
        0
      );
      assert.equal(total, 0, "a hand between equals moves rating from one to the other, not into it");
    } finally {
      alice.socket.close();
      bob.socket.close();
    }
  });

  test("a player can read their own replay back, and cannot read a stranger's", async () => {
    const { alice, bob } = await playOneHand("own");
    const stranger = await connectAs(server, "own_stranger");
    try {
      await waitForRow(async () => {
        const res = await dbPool.query(
          "SELECT id FROM match_replays WHERE player_ids @> $1::jsonb",
          [JSON.stringify([alice.user.id])]
        );
        return res.rows[0] ?? null;
      });

      const list = await fetch(`${server.url}/api/replays`, { headers: { cookie: alice.cookie } });
      assert.equal(list.status, 200);
      const summaries = await list.json();
      assert.equal(summaries.length, 1);
      assert.equal(summaries[0].playerCount, 3);
      assert.ok(summaries[0].moveCount > 0);

      const id = summaries[0].id;
      const mine = await fetch(`${server.url}/api/replays/${id}`, { headers: { cookie: alice.cookie } });
      assert.equal(mine.status, 200);

      const theirs = await fetch(`${server.url}/api/replays/${id}`, {
        headers: { cookie: stranger.cookie },
      });
      assert.equal(theirs.status, 404, "a replay of a table you did not sit at does not exist to you");
    } finally {
      alice.socket.close();
      bob.socket.close();
      stranger.socket.close();
    }
  });
});
