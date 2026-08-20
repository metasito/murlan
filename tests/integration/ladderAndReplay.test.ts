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

// Each test plays its own hand under its own `playOneHand` prefix, so its own
// accounts and its own room — and every registry the server keeps is keyed by
// room or user. Sequentially these seven cost 126s, the longest file in the
// suite by an order of magnitude and so the floor for `npm test`, which runs
// files concurrently but never the tests inside one.
describe("ladder and replay writes", { concurrency: true, skip: hasDatabase() ? false : skipMessage() }, () => {
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

  /**
   * The cheapest exploit there was: watch your hand, and when it is clearly
   * lost, close the tab. Nothing was written for the quitter — their seat left
   * `playerMap` and scored as `bot:<seat>`, which every write filters out —
   * and heads-up the survivor lost their win with it, because a two-player
   * table was disposed without ever reaching the scoring path.
   */
  test("a player who drops mid-hand is rated as last, and their opponent is rated for the win", async () => {
    const quitter = await connectAs(server, "quit_qara");
    const survivor = await connectAs(server, "quit_sten");
    try {
      const created = waitFor<RoomState>(quitter.socket, "room:state");
      quitter.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
      const room = await created;

      const joined = waitFor<RoomState>(survivor.socket, "room:state");
      survivor.socket.emit("room:join", { code: room.code });
      await joined;

      const dealt = [quitter, survivor].map((c) => waitFor(c.socket, "game:state"));
      quitter.socket.emit("room:start");
      await Promise.all(dealt);

      // Mid-hand: neither seat has emptied a hand, and the match is nowhere
      // near its target.
      quitter.socket.disconnect();

      const season = seasonKey(new Date());
      const rows = await waitForRow<
        { user_id: string; rating: number; games: number; season: string }[]
      >(async () => {
        const res = await dbPool.query(
          "SELECT user_id, rating, games, season FROM user_ratings WHERE user_id = ANY($1)",
          [[quitter.user.id, survivor.user.id]]
        );
        return res.rows.length === 2 ? res.rows : null;
      }, 15_000);

      const ratingOf = (id: string) => {
        const row = rows.find((r) => r.user_id === id);
        assert.ok(row, `no user_ratings row for ${id}`);
        assert.equal(row.season, season);
        assert.equal(Number(row.games), 1, "the abandoned hand counts as a game for both");
        return Number(row.rating);
      };

      assert.ok(
        ratingOf(quitter.user.id) < START_RATING,
        "walking out of a hand has to cost rating"
      );
      assert.ok(
        ratingOf(survivor.user.id) > START_RATING,
        "the player left at the table has to be paid for the win"
      );
    } finally {
      quitter.socket.close();
      survivor.socket.close();
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

      // The list is a projection now, so the summary has to still carry
      // exactly ReplaySummary — no column dropped, and none of the ones it
      // deliberately leaves in the database (moves, rankings, player_ids,
      // room_code) handed out with it.
      assert.deepEqual(Object.keys(summaries[0]).sort(), [
        "finishedAt",
        "gameMode",
        "id",
        "moveCount",
        "playerCount",
        "seats",
      ]);
      const stored = await dbPool.query(
        "SELECT moves FROM match_replays WHERE id = $1",
        [summaries[0].id]
      );
      assert.equal(
        summaries[0].moveCount,
        (stored.rows[0].moves as ReplayMove[]).length,
        "the counted length must be the stored length"
      );

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

  test("the list counts the moves in Postgres and leaves them there", async () => {
    const { alice, bob } = await playOneHand("proj");
    try {
      await waitForRow(async () => {
        const res = await dbPool.query(
          "SELECT id FROM match_replays WHERE player_ids @> $1::jsonb",
          [JSON.stringify([alice.user.id])]
        );
        return res.rows[0] ?? null;
      });

      // The listing must not pull the `moves` jsonb — ~9 KB per row, twenty
      // rows — to report its length. The response shape cannot show that, so
      // the SQL itself is what is read, off the app's own pool.
      const { pool } = await import("../../server/db.ts");
      const { listReplaysForUser } = await import("../../server/replays.ts");
      const seen: string[] = [];
      const realQuery = pool.query.bind(pool);
      (pool as { query: unknown }).query = (...args: unknown[]) => {
        const first = args[0];
        seen.push(typeof first === "string" ? first : String((first as { text?: string })?.text));
        return (realQuery as (...a: unknown[]) => unknown)(...args);
      };
      let summaries;
      try {
        summaries = await listReplaysForUser(alice.user.id);
      } finally {
        (pool as { query: unknown }).query = realQuery;
      }

      const sql = seen.join("\n");
      assert.match(sql, /jsonb_array_length\("moves"\)/, "the count must be Postgres' job");
      assert.equal(
        sql.split('"moves"').length - 1,
        1,
        `the move log is named twice, so one of those is a fetch:\n${sql}`
      );
      assert.ok(summaries[0].moveCount > 0);

      // And the predicate the list filters on has to reach the index.
      // enable_seqscan is off because the planner is right to scan a table
      // this small — the question here is whether it *could* use the index,
      // which a btree on a containment predicate never can.
      const client = await dbPool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL enable_seqscan = off");
        const explained = await client.query<{ "QUERY PLAN": string }>(
          "EXPLAIN SELECT id FROM match_replays WHERE player_ids @> $1::jsonb",
          [JSON.stringify([alice.user.id])]
        );
        const plan = explained.rows.map((r) => r["QUERY PLAN"]).join("\n");
        assert.match(plan, /match_replays_player_ids_idx/, `planned a scan instead:\n${plan}`);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    } finally {
      alice.socket.close();
      bob.socket.close();
    }
  });

  // Every other table naming a user cascades on delete. match_replays cannot —
  // a replay belongs to up to four players, so it carries their ids and display
  // names inside jsonb. Without this, deleting your account left your username
  // sitting in other people's replays.
  test("deleting an account erases that player from replays others keep", async () => {
    const { alice, bob } = await playOneHand("del");
    try {
      const before = await waitForRow(async () => {
        const res = await dbPool.query(
          "SELECT id, player_ids, seats FROM match_replays WHERE player_ids @> $1::jsonb",
          [JSON.stringify([alice.user.id])]
        );
        return res.rows[0] ?? null;
      });
      assert.ok(
        (before.seats as ReplaySeat[]).some((s) => s.userId === alice.user.id),
        "the seat starts out naming Alice"
      );

      const res = await fetch(`${server.url}/api/users/me`, {
        method: "DELETE",
        headers: { cookie: alice.cookie },
      });
      assert.equal(res.status, 200, await res.text());

      const after = await dbPool.query(
        "SELECT player_ids, seats FROM match_replays WHERE id = $1",
        [before.id]
      );
      assert.equal(after.rows.length, 1, "Bob keeps the replay he played in");

      const seats = after.rows[0].seats as ReplaySeat[];
      const ids = after.rows[0].player_ids as string[];
      assert.ok(!ids.includes(alice.user.id), "her id is out of the ownership filter");
      assert.ok(ids.includes(bob.user.id), "his is not");

      const hers = seats.find((s) => s.name === "");
      assert.ok(hers, "her seat is blanked rather than removed, so the hand still has four");
      assert.equal(hers.userId, null);
      assert.equal(seats.length, 3, "the seat count is untouched");
      assert.ok(
        !JSON.stringify(seats).includes(alice.user.username),
        "her username is gone from the row entirely"
      );
    } finally {
      alice.socket.close();
      bob.socket.close();
    }
  });
});
