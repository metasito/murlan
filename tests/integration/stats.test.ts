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
import { connectAs, waitFor, register } from "../helpers/client.ts";
import {
  driveHumansToRoundOver,
  waitForRow,
  type RoomState,

} from "../helpers/gameDriver.ts";
import { waitForDeal } from "../helpers/table.ts";
import { whileUserLocked } from "../helpers/userLock.ts";

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

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
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

      const payload = await driveHumansToRoundOver([alice.socket, bob.socket], () => {
        alice.socket.emit("room:start", { fillWithBots: true, botPersonality: "luan" });
      });
      assert.ok(payload, "game:over must fire");

      for (const { user } of [alice, bob]) {
        const statsRow = await waitForRow(async () => {
          const res = await server.query(
            "SELECT user_id, rounds_played, rounds_won FROM user_stats WHERE user_id = $1",
            [user.id]
          );
          return res[0] ?? null;
        });
        assert.equal(statsRow.user_id, user.id);
        assert.equal(Number(statsRow.rounds_played), 1);

        const historyRows = await waitForRow(async () => {
          const res = await server.query(
            "SELECT user_id, game_mode, placement, player_count, points, opponents FROM round_history WHERE user_id = $1",
            [user.id]
          );
          return res.length > 0 ? res : null;
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
      const botStats = await server.query(
        "SELECT 1 FROM user_stats WHERE user_id LIKE 'bot:%'"
      );
      assert.equal(botStats.length, 0, "no bot seat should ever appear in user_stats");

      const botHistory = await server.query(
        "SELECT 1 FROM round_history WHERE user_id LIKE 'bot:%'"
      );
      assert.equal(botHistory.length, 0, "no bot seat should ever appear in round_history");
    } finally {
      alice.socket.close();
      bob.socket.close();
    }
  });

  /**
   * The profile's one card reads through `getRoundHistoryView`, which pairs a
   * history row to its replay on `(userId, finishedAt)` — the two tables share
   * no key, and before #739 the only correlation available was "written within
   * a few milliseconds of each other".
   */
  test("the history view names the table and pairs each round to its replay", async () => {
    const cara = await connectAs(server, "view_cara");
    const dan = await connectAs(server, "view_dan");
    try {
      const created = waitFor<RoomState>(cara.socket, "room:state");
      cara.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 3 });
      const room = await created;

      const joined = waitFor<RoomState>(dan.socket, "room:state");
      dan.socket.emit("room:join", { code: room.code });
      await joined;

      const payload = await driveHumansToRoundOver([cara.socket, dan.socket], () => {
        cara.socket.emit("room:start", { fillWithBots: true, botPersonality: "luan" });
      });
      assert.ok(payload, "game:over must fire");

      const { getRoundHistoryView } = await import("../../server/http/roundHistoryView.ts");
      const rows = await waitForRow(async () => {
        const view = await getRoundHistoryView(cara.user.id);
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
      const paired = await server.query(
        `SELECT r.id FROM round_replays r
           JOIN round_history h ON h.finished_at = r.finished_at
          WHERE r.id = $1 AND h.user_id = $2 AND h.id = $3`,
        [hand.replayId, cara.user.id, hand.id]
      );
      assert.equal(
        paired.length,
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
  test("a round with no paired replay is listed, unwatchable, with its bot seats unnamed", async () => {
    const { user } = await register(server, "view_unpaired");
    await server.query(
      `INSERT INTO round_history (user_id, finished_at, game_mode, placement, player_count, points, opponents)
       VALUES ($1, now() - interval '30 days', 'free_for_all', 2, 3, 1, $2::jsonb)`,
      [user.id, JSON.stringify(["bot:1", "bot:2"])]
    );

    const { getRoundHistoryView } = await import("../../server/http/roundHistoryView.ts");
    const [hand] = await getRoundHistoryView(user.id);

    assert.equal(hand.replayId, null, "no replay pairs it, so nothing offers to play it");
    assert.deepEqual(hand.participants, [
      { name: null, bot: true },
      { name: null, bot: true },
    ]);
  });

  /**
   * Leaving a round in progress used to produce no record at all for the
   * leaver: their seat drops out of `playerMap`, after which it scores as
   * `bot:<seat>` and every write here filters it out. A losing round cost
   * nothing to walk away from.
   */
  test("a player who leaves mid-round is recorded as a last-place finish and earns nothing", async () => {
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

      // A bot takes the empty seat, so the round reaches game over the ordinary
      // way and the seat that was walked out on is scored inside it.
      await driveHumansToRoundOver(
        stayers.map((c) => c.socket),
        () => leaver.socket.emit("room:leave")
      );

      const history = await waitForRow(async () => {
        const res = await server.query(
          "SELECT placement, player_count FROM round_history WHERE user_id = $1",
          [leaver.user.id]
        );
        return res[0] ?? null;
      });
      assert.equal(Number(history.placement), 4, "an abandonment is recorded as last of the table");
      assert.equal(Number(history.player_count), 4);

      const stats = await server.query(
        "SELECT rounds_played, rounds_won, current_streak FROM user_stats WHERE user_id = $1",
        [leaver.user.id]
      );
      assert.equal(Number(stats[0].rounds_played), 1, "the round counts as played");
      assert.equal(Number(stats[0].rounds_won), 0);
      assert.equal(Number(stats[0].current_streak), 0, "and it breaks the streak");

      // Written in the same transaction as the history row above, so this read
      // is not a race: the round's achievements have already had their chance.
      const unlocked = await server.query(
        "SELECT achievement_id FROM user_achievements WHERE user_id = $1",
        [leaver.user.id]
      );
      assert.deepEqual(unlocked, [], "nothing is earned from a round you walked out on");
    } finally {
      clients.forEach((c) => c.socket.close());
    }
  });

  /**
   * The walkout is last, and every seat that played the round out keeps the
   * position it earned — one total order, so no two seats share a number.
   * The bot that inherits a vacated seat routinely finishes ahead of a player
   * who stayed, and placing the walkout last while everyone else is numbered
   * by their own finishing-order index hands the same placement to two seats. Nothing
   * refuses that: round_history stores it verbatim, and lib/game/rating.ts breaks
   * the tie by sorting, which rates the quitter ahead of the player they tied
   * with.
   */
  test("every seat of a round someone walked out on gets a distinct placement", async () => {
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

      await driveHumansToRoundOver(
        stayers.map((c) => c.socket),
        () => leaver.socket.emit("room:leave")
      );

      const rows = await waitForRow<{ user_id: string; placement: number }[]>(async () => {
        const res = await server.query<{ user_id: string; placement: number }>(
          "SELECT user_id, placement FROM round_history WHERE user_id = ANY($1)",
          [clients.map((c) => c.user.id)]
        );
        return res.length === 4 ? res : null;
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
   * The gate that decides whether a round is recorded at all counts an
   * abandoned seat as the human seat it is. A two-human table filled to four
   * with bots is contested; counting the seat someone walked out on as a
   * third bot makes it bot-majority and drops every write — losing the round
   * for the player who stayed, in the one case the gate exists to protect.
   *
   * #850 clause 11 (docs/GAME-RULES.md § Decisions) voids a match abandoned before its
   * first point, which would swallow a first-round walkout whole and never
   * reach the gate this test exists to protect. Playing the first round out
   * for real, then abandoning the second, is what keeps this test honest
   * about the thing it is pinning.
   */
  test("a round on a half-bot table is still recorded when a human walks out", async () => {
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

      await driveHumansToRoundOver([stayer.socket, leaver.socket], () => {});

      const nextDeal = waitForDeal(stayer.socket);
      stayer.socket.emit("game:rematch_vote");
      leaver.socket.emit("game:rematch_vote");
      await nextDeal;

      // One human left at the table: the round is conceded to them there and
      // then, and the walkout is scored inside it.
      leaver.socket.emit("room:leave");

      // Two rounds, two rows each by now — the first round, played out fairly,
      // already wrote one row per user before the walkout below could. Only
      // the latest row per user is the one the walkout wrote.
      // One statement, so the count and the latest row come from one snapshot: each seat commits in its own transaction.
      const rows = await waitForRow<{ user_id: string; placement: number; player_count: number; n: number }[]>(
        async () => {
          const res = await server.query<{ user_id: string; placement: number; player_count: number; n: number }>(
            `SELECT DISTINCT ON (user_id) user_id, placement, player_count,
                    COUNT(*) OVER (PARTITION BY user_id)::int AS n
             FROM round_history WHERE user_id = ANY($1)
             ORDER BY user_id, finished_at DESC`,
            [[stayer.user.id, leaver.user.id]]
          );
          if (res.length !== 2) return null;
          const bothHaveTwo = res.every((r) => Number(r.n) === 2);
          return bothHaveTwo ? res : null;
        },
        15_000
      );

      const rowOf = (id: string) => rows.find((r) => r.user_id === id)!;
      assert.equal(Number(rowOf(stayer.user.id).placement), 1, "the player left at the table takes the round");
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
    // would resolve server/store/db.ts's module-scope Pool against whatever
    // DATABASE_URL was set before this file's before() hook ran (see
    // tests/helpers/testServer.ts's own comment on this).
    const { recordGameResult, getUserAchievements } = await import("../../server/game/stats.ts");

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
    // A distinct end time per round, as real play gives them: the prune keeps
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

    const botRows = await server.query(
      "SELECT 1 FROM round_history WHERE user_id = 'bot:0' UNION SELECT 1 FROM user_stats WHERE user_id = 'bot:0'"
    );
    assert.equal(botRows.length, 0, "the bot seat riding along in the batch must never be written");

    const statsRes = await server.query(
      "SELECT rounds_played, rounds_won, current_streak, best_streak FROM user_stats WHERE user_id = $1",
      [user.id]
    );
    assert.equal(statsRes.length, 1);
    assert.equal(Number(statsRes[0].rounds_played), 52);
    assert.equal(Number(statsRes[0].rounds_won), 52);
    assert.equal(Number(statsRes[0].current_streak), 52);
    assert.equal(Number(statsRes[0].best_streak), 52);

    const historyRes = await server.query(
      "SELECT count(*) FROM round_history WHERE user_id = $1",
      [user.id]
    );
    assert.equal(Number(historyRes[0].count), 50, "history must be pruned to 50 rows");

    // placement 1, playerCount 2, no bomb/joker, no match win: earns
    // exactly first_win / purist / minimalist / duelist (see
    // lib/achievements.ts's predicates) — each exactly once despite 52 calls.
    const achievements = await getUserAchievements(user.id);
    const unlocked = achievements.filter((a) => a.unlocked).map((a) => a.id).sort();
    assert.deepEqual(unlocked, ["duelist", "first_win", "minimalist", "purist"]);
  });

  test("two hands for one player wait on the row lock, and both history rows survive the prune", async () => {
    const { user } = await register(server, "stats_race_user");
    await server.query(
      `INSERT INTO round_history (user_id, finished_at, game_mode, placement, player_count, points)
       SELECT $1, now() - make_interval(hours => g), 'free_for_all', 2, 2, 0 FROM generate_series(1, $2::int) g`,
      [user.id, 50]
    );
    const { recordGameResult, MAX_HISTORY_ROWS_PER_USER } = await import("../../server/game/stats.ts");
    const result: GameResult = {
      userId: user.id,
      placement: 1,
      playerCount: 2,
      playedBomb: false,
      playedJoker: false,
      matchWon: false,
      opponentsFinished: 0,
    };
    const ends = [new Date(Date.now() + 1_000), new Date(Date.now() + 2_000)];
    await whileUserLocked([user.id], () => ends.map((end) => recordGameResult([result], "free_for_all", end)));

    const rows = await server.query(
      "SELECT (extract(epoch FROM finished_at) * 1000)::bigint AS ms FROM round_history WHERE user_id = $1",
      [user.id]
    );
    assert.equal(rows.length, MAX_HISTORY_ROWS_PER_USER);
    const kept = rows.map((r) => Number(r.ms));
    for (const end of ends) assert.ok(kept.includes(end.getTime()), `the round ending ${end.toISOString()} was pruned`);
    const stats = await server.query("SELECT rounds_played FROM user_stats WHERE user_id = $1", [user.id]);
    assert.equal(Number(stats[0].rounds_played), 2);
  });
});
