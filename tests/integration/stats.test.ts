import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import type { Socket } from "socket.io-client";
import type { Card, GameMode } from "../../lib/gameEngine.ts";
import { getValidGivebackCards } from "../../lib/gameEngine.ts";
import type { GameResult } from "../../lib/achievements.ts";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { connectAs, waitFor, register } from "../helpers/client.ts";

/**
 * Task 8: recordGameResult is called (fire-and-forget) from the game-over
 * path. Shortened well below production defaults so an active exchange
 * phase resolves quickly via the AFK path instead of stalling this suite —
 * same convention as tests/integration/gameplay.test.ts.
 */
process.env.MURLAN_AFK_TIMEOUT_MS = "300";
process.env.MURLAN_DISCONNECT_GRACE_MS = "500";

interface ExchangePhase {
  active: boolean;
  winnerIdx: number;
  loserIdx: number;
  cardFromLoser: Card;
  bothJokersException: boolean;
}

interface SanitizedPlayer {
  id: string;
  name: string;
  hand: Card[];
  handCount: number;
  type: string;
}

interface SanitizedState {
  players: SanitizedPlayer[];
  currentTurnIndex: number;
  lastPlayedCombination: unknown | null;
  gameOver: boolean;
  firstPlayMade: boolean;
  startCard?: Card;
  exchangePhase?: ExchangePhase;
  viewerSeatIndex: number;
}

interface RoomState {
  roomId: string;
  code: string;
}

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

  /**
   * Drives every given human client's own turns to completion: forced-
   * minimum grouped plays on a new round, pass otherwise, and an immediate
   * (valid) giveback the instant a seat is the exchange winner — the same
   * strategy tests/integration/gameplay.test.ts's driveHandToExchangeOrOver
   * uses, extended to run past any exchange phase all the way to
   * "game:over" instead of stopping at the first one.
   *
   * Real clients only — a bot-filled seat is intentionally left to the
   * server's own turn arbiter (armTurn/runBotTurn), which paces bot moves
   * roughly 1.2s apart. Driving the *human* seats immediately, rather than
   * also waiting on AFK timers for them, keeps the wall-clock cost of this
   * test down to "however many bot turns the table needs", not "every
   * turn at the human/bot pace".
   */
  function driveHumansToGameOver(
    clients: Socket[],
    kickoff: () => void
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const seats = new Map<Socket, number>();

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("timed out driving the table to game:over"));
      }, 60_000);

      function cleanup() {
        clearTimeout(timer);
        for (const c of clients) {
          c.off("game:state", handlers.get(c)!);
          c.off("game:over", onOver);
        }
      }

      function onOver(payload: unknown) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(payload);
      }

      const handlers = new Map<Socket, (state: SanitizedState) => void>();

      for (const client of clients) {
        const onState = (state: SanitizedState) => {
          if (settled || state.gameOver) return;
          if (!seats.has(client)) seats.set(client, state.viewerSeatIndex);
          const seat = seats.get(client)!;

          if (state.exchangePhase?.active) {
            if (state.exchangePhase.winnerIdx !== seat) return;
            const hand = state.players[seat]?.hand ?? [];
            const [card] = getValidGivebackCards(hand);
            if (card) client.emit("game:exchange_give_card", { cardId: card.id });
            return;
          }

          if (state.currentTurnIndex !== seat) return;
          const hand = state.players[seat]?.hand ?? [];
          if (hand.length === 0) return;

          if (state.lastPlayedCombination !== null) {
            client.emit("game:pass");
            return;
          }

          let anchor = hand[0];
          if (!state.firstPlayMade && state.startCard) {
            const forced = hand.find((c) => c.id === state.startCard!.id);
            if (forced) anchor = forced;
          }
          const group = hand.filter((c) => c.rank === anchor.rank).map((c) => c.id);
          client.emit("game:play", { cardIds: group });
        };
        handlers.set(client, onState);
        client.on("game:state", onState);
        client.on("game:over", onOver);
      }

      kickoff();
    });
  }

  /** Polls until `check` returns a truthy value or the timeout elapses — the
   * write this suite is asserting on is deliberately fire-and-forget from
   * the game-over path, so it can land a beat after "game:over" itself. */
  async function waitForRow<T>(
    check: () => Promise<T | null>,
    ms = 5_000
  ): Promise<T> {
    const deadline = Date.now() + ms;
    for (;;) {
      const row = await check();
      if (row) return row;
      if (Date.now() > deadline) throw new Error("timed out waiting for a DB row to appear");
      await new Promise((r) => setTimeout(r, 100));
    }
  }

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
        alice.socket.emit("room:start", { fillWithBots: true, botDifficulty: "easy" });
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
    for (let i = 0; i < 52; i++) {
      await recordGameResult([result, botResult], gameMode);
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
