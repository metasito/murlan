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
import { connectAs, waitFor, register } from "../helpers/client.ts";
import {
  driveHumansToGameOver,
  waitForRow,
  type RoomState,

} from "../helpers/gameDriver.ts";
import { waitForDeal } from "../helpers/table.ts";

/**
 * recordGameResult is called (fire-and-forget) from the game-over path.
 * Shortened well below production defaults so an active exchange phase
 * resolves quickly via the AFK path instead of stalling this suite — same
 * convention as tests/integration/gameplay.test.ts.
 */
process.env.MURLAN_AFK_TIMEOUT_MS = "300";
process.env.MURLAN_DISCONNECT_GRACE_MS = "500";

describe("stats persistence (Task 8)", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  let dbPool: pg.Pool;

  before(async () => {
    server = await startTestServer();
    // The scoped connection string is still live in process.env.DATABASE_URL
    // at this point (testServer.ts only restores the original on stop()), so
    // a plain pg.Pool here reads/writes the exact same throwaway schema the
    // app itself is using.
    dbPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  });

  after(async () => {
    await dbPool.end();
    await server.stop();
  });

  test("a completed game records stats and history for both humans, and nothing for the bot seat", async () => {
    const alice = await connectAs(server, "stats_alice");
    const bob = await connectAs(server, "stats_bob");
    try {
      const created = waitFor<RoomState>(alice.socket, "room:state");
      alice.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 3 });
      const room = await created;

      const joined = waitFor<RoomState>(bob.socket, "room:state");
      bob.socket.emit("room:join", { code: room.code });
      await joined;

      const payload = await driveHumansToGameOver([alice.socket, bob.socket], () => {
        alice.socket.emit("room:start", { fillWithBots: true, botPersonality: "luan" });
      });
      assert.ok(payload, "game:over must fire");

      for (const { user } of [alice, bob]) {
        const statsRow = await waitForRow(async () => {
          const res = await dbPool.query(
            "SELECT user_id, games_played, games_won FROM user_stats WHERE user_id = $1",
            [user.id]
          );
          return res.rows[0] ?? null;
        });
        assert.equal(statsRow.user_id, user.id);
        assert.equal(Number(statsRow.games_played), 1);

        const historyRows = await waitForRow(async () => {
          const res = await dbPool.query(
            "SELECT user_id, game_mode, placement, player_count, points, opponents FROM match_history WHERE user_id = $1",
            [user.id]
          );
          return res.rows.length > 0 ? res.rows : null;
        });
        assert.equal(historyRows.length, 1);
        assert.equal(historyRows[0].game_mode, "free_for_all");
        assert.equal(Number(historyRows[0].player_count), 3);
        assert.ok(
          Number(historyRows[0].placement) >= 1 && Number(historyRows[0].placement) <= 3,
          "placement must be within the seated player count"
        );
      }

      // Bot seats (synthetic `bot:<seat>` ids) must never reach either
      // table — they have no `users` row, so a write for them would violate
      // the foreign key. No polling needed here: both humans' rows above
      // have already landed, so the fire-and-forget write has had its chance.
      const botStats = await dbPool.query(
        "SELECT 1 FROM user_stats WHERE user_id LIKE 'bot:%'"
      );
      assert.equal(botStats.rows.length, 0, "no bot seat should ever appear in user_stats");

      const botHistory = await dbPool.query(
        "SELECT 1 FROM match_history WHERE user_id LIKE 'bot:%'"
      );
      assert.equal(botHistory.rows.length, 0, "no bot seat should ever appear in match_history");
    } finally {
      alice.socket.close();
      bob.socket.close();
    }
  });

  /**
   * The profile's one card reads through `getMatchHistoryView`, which pairs a
   * history row to its replay on `(userId, finishedAt)` — the two tables share
   * no key, and before #739 the only correlation available was "written within
   * a few milliseconds of each other".
   */
  test("the history view names the table and pairs each hand to its replay", async () => {
    const cara = await connectAs(server, "view_cara");
    const dan = await connectAs(server, "view_dan");
    try {
      const created = waitFor<RoomState>(cara.socket, "room:state");
      cara.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 3 });
      const room = await created;

      const joined = waitFor<RoomState>(dan.socket, "room:state");
      dan.socket.emit("room:join", { code: room.code });
      await joined;

      const payload = await driveHumansToGameOver([cara.socket, dan.socket], () => {
        cara.socket.emit("room:start", { fillWithBots: true, botPersonality: "luan" });
      });
      assert.ok(payload, "game:over must fire");

      const { getMatchHistoryView } = await import("../../server/matchHistoryView.ts");
      const rows = await waitForRow(async () => {
        const view = await getMatchHistoryView(cara.user.id);
        return view.length > 0 && view[0].replayId !== null ? view : null;
      });

      assert.equal(rows.length, 1);
      const [hand] = rows;
      assert.equal(
        hand.participants.length,
        2,
        "the other two seats, the bot included — `opponents` holds both"
      );

      const human = hand.participants.find((p) => !p.bot);
      assert.equal(human?.name, dan.user.username, "a human seat reads as their account name");

      const bot = hand.participants.find((p) => p.bot);
      assert.ok(bot, "the bot seat must still be listed");
      assert.ok(
        bot.name && !bot.name.startsWith("bot:"),
        `a bot seat must read as its name, got ${JSON.stringify(bot.name)}`
      );

      // Asked of Postgres rather than of two Dates in here: drizzle and the raw
      // pg client parse `timestamp without time zone` against different zones,
      // so equal columns read back as Dates an offset apart. The claim is about
      // the stored values, which is where it can be asked without that.
      const paired = await dbPool.query(
        `SELECT r.id FROM match_replays r
           JOIN match_history h ON h.finished_at = r.finished_at
          WHERE r.id = $1 AND h.user_id = $2 AND h.id = $3`,
        [hand.replayId, cara.user.id, hand.id]
      );
      assert.equal(
        paired.rows.length,
        1,
        "the pairing is one shared instant across both tables, not proximity"
      );
    } finally {
      cara.socket.close();
      dan.socket.close();
    }
  });

  /**
   * Every row written before #739 has a `finishedAt` of its own, so it pairs
   * with no replay however recently it was played. That is the same shape as a
   * replay that has expired, which is what the card already has to render.
   */
  test("a hand with no paired replay is listed, unwatchable, with its bot seats unnamed", async () => {
    const { user } = await register(server, "view_unpaired");
    await dbPool.query(
      `INSERT INTO match_history (user_id, finished_at, game_mode, placement, player_count, points, opponents)
       VALUES ($1, now() - interval '30 days', 'free_for_all', 2, 3, 1, $2::jsonb)`,
      [user.id, JSON.stringify(["bot:1", "bot:2"])]
    );

    const { getMatchHistoryView } = await import("../../server/matchHistoryView.ts");
    const [hand] = await getMatchHistoryView(user.id);

    assert.equal(hand.replayId, null, "no replay pairs it, so nothing offers to play it");
    assert.deepEqual(hand.participants, [
      { name: null, bot: true },
      { name: null, bot: true },
    ]);
  });

  /**
   * Leaving a hand in progress used to produce no record at all for the
   * leaver: their seat drops out of `playerMap`, after which it scores as
   * `bot:<seat>` and every write here filters it out. A losing hand cost
   * nothing to walk away from.
   */
  test("a player who leaves mid-hand is recorded as a last-place finish and earns nothing", async () => {
    const clients = [];
    for (const name of ["quit_ada", "quit_bea", "quit_cleo", "quit_dora"]) {
      clients.push(await connectAs(server, name));
    }
    const [leaver, ...stayers] = clients;
    try {
      const created = waitFor<RoomState>(leaver.socket, "room:state");
      leaver.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 4 });
      const room = await created;
      for (const c of stayers) {
        const joined = waitFor<RoomState>(c.socket, "room:state");
        c.socket.emit("room:join", { code: room.code });
        await joined;
      }

      const dealt = clients.map((c) => waitFor(c.socket, "game:state"));
      leaver.socket.emit("room:start");
      await Promise.all(dealt);

      // A bot takes the empty seat, so the hand reaches game over the ordinary
      // way and the seat that was walked out on is scored inside it.
      await driveHumansToGameOver(
        stayers.map((c) => c.socket),
        () => leaver.socket.emit("room:leave")
      );

      const history = await waitForRow(async () => {
        const res = await dbPool.query(
          "SELECT placement, player_count FROM match_history WHERE user_id = $1",
          [leaver.user.id]
        );
        return res.rows[0] ?? null;
      });
      assert.equal(Number(history.placement), 4, "a forfeit is recorded as last of the table");
      assert.equal(Number(history.player_count), 4);

      const stats = await dbPool.query(
        "SELECT games_played, games_won, current_streak FROM user_stats WHERE user_id = $1",
        [leaver.user.id]
      );
      assert.equal(Number(stats.rows[0].games_played), 1, "the hand counts as played");
      assert.equal(Number(stats.rows[0].games_won), 0);
      assert.equal(Number(stats.rows[0].current_streak), 0, "and it breaks the streak");

      // Written in the same transaction as the history row above, so this read
      // is not a race: the hand's achievements have already had their chance.
      const unlocked = await dbPool.query(
        "SELECT achievement_id FROM user_achievements WHERE user_id = $1",
        [leaver.user.id]
      );
      assert.deepEqual(unlocked.rows, [], "nothing is earned from a hand you walked out on");
    } finally {
      clients.forEach((c) => c.socket.close());
    }
  });

  /**
   * The walkout is last, and every seat that played the hand out keeps the
   * position it earned — one total order, so no two seats share a number.
   * The AI that inherits a vacated seat routinely finishes ahead of a player
   * who stayed, and placing the walkout last while everyone else is numbered
   * by their own ranking index hands the same placement to two seats. Nothing
   * refuses that: match_history stores it verbatim, and lib/rating.ts breaks
   * the tie by sorting, which rates the quitter ahead of the player they tied
   * with.
   */
  test("every seat of a hand someone walked out on gets a distinct placement", async () => {
    const clients: Awaited<ReturnType<typeof connectAs>>[] = [];
    for (const name of ["dist_ada", "dist_bea", "dist_cleo", "dist_dora"]) {
      clients.push(await connectAs(server, name));
    }
    const [leaver, ...stayers] = clients;
    try {
      const created = waitFor<RoomState>(leaver.socket, "room:state");
      leaver.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 4 });
      const room = await created;
      for (const c of stayers) {
        const joined = waitFor<RoomState>(c.socket, "room:state");
        c.socket.emit("room:join", { code: room.code });
        await joined;
      }

      const dealt = clients.map((c) => waitFor(c.socket, "game:state"));
      leaver.socket.emit("room:start");
      await Promise.all(dealt);

      await driveHumansToGameOver(
        stayers.map((c) => c.socket),
        () => leaver.socket.emit("room:leave")
      );

      const rows = await waitForRow<{ user_id: string; placement: number }[]>(async () => {
        const res = await dbPool.query(
          "SELECT user_id, placement FROM match_history WHERE user_id = ANY($1)",
          [clients.map((c) => c.user.id)]
        );
        return res.rows.length === 4 ? res.rows : null;
      });

      const placements = rows.map((r) => Number(r.placement)).sort((a, b) => a - b);
      assert.deepEqual(
        placements,
        [1, 2, 3, 4],
        "four seats finish a four-hander in four different places"
      );
      assert.equal(
        Number(rows.find((r) => r.user_id === leaver.user.id)!.placement),
        4,
        "and the seat that was walked out on is the last of them"
      );
    } finally {
      clients.forEach((c) => c.socket.close());
    }
  });

  /**
   * The gate that decides whether a hand is recorded at all counts an
   * abandoned seat as the human seat it is. A two-human table filled to four
   * with bots is contested; counting the seat someone walked out on as a
   * third bot makes it bot-majority and drops every write — losing the hand
   * for the player who stayed, in the one case the gate exists to protect.
   *
   * #850 clause 11 (docs/BRIEF.md §3.1) voids a match abandoned before its
   * first point, which would swallow a first-manche walkout whole and never
   * reach the gate this test exists to protect. Playing the first manche out
   * for real, then abandoning the second, is what keeps this test honest
   * about the thing it is pinning.
   */
  test("a hand on a half-bot table is still recorded when a human walks out", async () => {
    const stayer = await connectAs(server, "half_ilir");
    const leaver = await connectAs(server, "half_jeta");
    try {
      const created = waitFor<RoomState>(stayer.socket, "room:state");
      stayer.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 4 });
      const room = await created;

      const joined = waitFor<RoomState>(leaver.socket, "room:state");
      leaver.socket.emit("room:join", { code: room.code });
      await joined;

      const dealt = [stayer, leaver].map((c) => waitFor(c.socket, "game:state"));
      stayer.socket.emit("room:start", { fillWithBots: true, botPersonality: "luan" });
      await Promise.all(dealt);

      await driveHumansToGameOver([stayer.socket, leaver.socket], () => {});

      const nextDeal = waitForDeal(stayer.socket);
      stayer.socket.emit("game:rematch_vote");
      leaver.socket.emit("game:rematch_vote");
      await nextDeal;

      // One human left at the table: the hand is conceded to them there and
      // then, and the walkout is scored inside it.
      leaver.socket.emit("room:leave");

      // Two manches, two rows each by now — the first hand, played out fairly,
      // already wrote one row per user before the walkout below could. Only
      // the latest row per user is the one the walkout wrote.
      const rows = await waitForRow<{ user_id: string; placement: number; player_count: number }[]>(
        async () => {
          const res = await dbPool.query(
            `SELECT DISTINCT ON (user_id) user_id, placement, player_count
             FROM match_history WHERE user_id = ANY($1)
             ORDER BY user_id, finished_at DESC`,
            [[stayer.user.id, leaver.user.id]]
          );
          if (res.rows.length !== 2) return null;
          const countRes = await dbPool.query(
            "SELECT user_id, COUNT(*)::int AS n FROM match_history WHERE user_id = ANY($1) GROUP BY user_id",
            [[stayer.user.id, leaver.user.id]]
          );
          const bothHaveTwo = countRes.rows.every((r: { n: number }) => Number(r.n) === 2);
          return bothHaveTwo ? res.rows : null;
        },
        15_000
      );

      const rowOf = (id: string) => rows.find((r) => r.user_id === id)!;
      assert.equal(Number(rowOf(stayer.user.id).placement), 1, "the player left at the table takes the hand");
      assert.equal(Number(rowOf(leaver.user.id).placement), 4, "the walkout is last of four seats");
      assert.equal(Number(rowOf(stayer.user.id).player_count), 4);
    } finally {
      stayer.socket.close();
      leaver.socket.close();
    }
  });

  test("recordGameResult upserts stats, prunes history to 50 rows, and dedupes achievements", async () => {
    const { user } = await register(server, "stats_prune_user");

    // Dynamically imported after startTestServer() has pointed
    // DATABASE_URL at the scoped test schema — a static top-level import
    // would resolve server/db.ts's module-scope Pool against whatever
    // DATABASE_URL was set before this file's before() hook ran (see
    // tests/helpers/testServer.ts's own comment on this).
    const { recordGameResult, getUserAchievements } = await import("../../server/stats.ts");

    const result: GameResult = {
      userId: user.id,
      placement: 1,
      playerCount: 2,
      playedBomb: false,
      playedJoker: false,
      matchWon: false,
      opponentsFinished: 0,
    };
    const gameMode: GameMode = "free_for_all";

    // A bot seat riding along in the same batch every time: skipped
    // entirely, or this would throw a foreign-key violation (bot:0 has no
    // users row) and the loop below would never complete.
    const botResult: GameResult = { ...result, userId: "bot:0" };

    // 52 separate hands for the same user — well past the 50-row cap, and
    // repeated enough that a non-idempotent achievement insert would throw
    // on the composite primary key long before this loop finishes.
    // A distinct end time per hand, as real play gives them: the prune keeps
    // the newest 50 by `finishedAt`, so 52 rows sharing one instant would
    // leave which two go entirely to the database's discretion.
    const firstFinishedAt = Date.now() - 52 * 60_000;
    for (let i = 0; i < 52; i++) {
      await recordGameResult(
        [result, botResult],
        gameMode,
        new Date(firstFinishedAt + i * 60_000)
      );
    }

    const botRows = await dbPool.query(
      "SELECT 1 FROM match_history WHERE user_id = 'bot:0' UNION SELECT 1 FROM user_stats WHERE user_id = 'bot:0'"
    );
    assert.equal(botRows.rows.length, 0, "the bot seat riding along in the batch must never be written");

    const statsRes = await dbPool.query(
      "SELECT games_played, games_won, current_streak, best_streak FROM user_stats WHERE user_id = $1",
      [user.id]
    );
    assert.equal(statsRes.rows.length, 1);
    assert.equal(Number(statsRes.rows[0].games_played), 52);
    assert.equal(Number(statsRes.rows[0].games_won), 52);
    assert.equal(Number(statsRes.rows[0].current_streak), 52);
    assert.equal(Number(statsRes.rows[0].best_streak), 52);

    const historyRes = await dbPool.query(
      "SELECT count(*) FROM match_history WHERE user_id = $1",
      [user.id]
    );
    assert.equal(Number(historyRes.rows[0].count), 50, "history must be pruned to 50 rows");

    // placement 1, playerCount 2, no bomb/joker, no match win: earns
    // exactly first_win / purist / minimalist / duelist (see
    // lib/achievements.ts's predicates) — each exactly once despite 52 calls.
    const achievements = await getUserAchievements(user.id);
    const unlocked = achievements.filter((a) => a.unlocked).map((a) => a.id).sort();
    assert.deepEqual(unlocked, ["duelist", "first_win", "minimalist", "purist"]);
  });
});
