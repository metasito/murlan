import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { waitFor } from "../helpers/client.ts";
import {
  assertHandSecrecy,
  driveHandToExchangeOrOver,
  gameOverOf,
  makeClients,
  setUpRoom,
  waitForDeal,
  type Client,
} from "../helpers/table.ts";

/**
 * Shortened well below the 60s disconnect grace / 30s AFK / 1.2s bot-move
 * production defaults so a manche played out against bots finishes in about a
 * second. `server/socket.ts` reads these once at module scope, so they must be
 * set before that module is first imported — this file always runs as its own
 * process under `node --test`, so the override never leaks into another test
 * file's process.
 */
process.env.MURLAN_AFK_TIMEOUT_MS = "300";
process.env.MURLAN_BOT_MOVE_DELAY_MS = "20";

/**
 * `game:rematch_vote` deals the next manche from the running game's own
 * roster, never from `room_players`: that table holds humans only, so a roster
 * rebuilt from it drops every bot seat and renumbers the survivors — which
 * moves seats under `playerMap`, the one thing deciding whose cards a viewer
 * is sent and which seats the turn arbiter drives with the AI.
 *
 * Separate from gameplay.test.ts only because `/api/auth/register` is rate
 * limited to 20 per process and that suite already registers exactly 20.
 */
describe("rematch roster", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    await server.stop();
  });

  /**
   * Stops a table that is still mid-manche, so its bot and AFK timers don't
   * keep playing into the suite's teardown and write against a closed pool.
   * One leave is enough: it drops the table below two seated players, which
   * disposes it.
   */
  async function closeTable(roomId: string, host: Client) {
    const { __testables } = await import("../../server/socket.ts");
    host.socket.emit("room:leave");
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (!__testables.hasActiveGame(roomId)) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.fail("the table was still live after its host left");
  }

  test("a lone human plus bots deals a second manche with the same seats", async () => {
    const { __testables } = await import("../../server/socket.ts");
    const [ivan] = await makeClients(server, ["rematch_solo_ivan"]);
    const room = await setUpRoom([ivan], 4);

    const over = gameOverOf(
      await driveHandToExchangeOrOver([ivan], () => {
        ivan.socket.emit("room:start", { fillWithBots: true, botPersonality: "gent" });
      })
    );
    const seatedBefore = __testables.seatedUsers(room.roomId);
    assert.deepEqual(seatedBefore, { 0: ivan.user.id });

    const dealt = waitForDeal(ivan.socket);
    const started = waitFor(ivan.socket, "game:started", 8_000);
    ivan.socket.emit("game:rematch_vote");
    const next = await dealt;
    await started;

    assert.equal(next.players.length, 4, "the next manche must keep every seat");
    assert.equal(next.players.filter((p) => p.type === "ai").length, 3);
    assertHandSecrecy(next, "solo rematch deal");
    // A seat with no playerMap entry is exactly what armTurn drives with the
    // AI, so this is the assertion that the three bot seats are still bots and
    // that the human's seat did not move under him.
    assert.deepEqual(
      __testables.seatedUsers(room.roomId),
      seatedBefore,
      "seat numbering must not change across a manche"
    );

    const phase = next.exchangePhase;
    assert.ok(phase, "a rematch deal always carries an exchange phase");
    assert.equal(
      next.players[phase.winnerIdx].id,
      over.rankings[0],
      "the exchange must be seeded from the previous manche's winner"
    );

    // And the second manche is playable end to end: the bot seats really act.
    gameOverOf(
      await driveHandToExchangeOrOver([ivan], () => {}, { stopOnExchange: false })
    );
    await closeTable(room.roomId, ivan);
  });

  test("a two-human, two-bot table keeps all four seats across a rematch", async () => {
    const { __testables } = await import("../../server/socket.ts");
    const [jack, kira] = await makeClients(server, [
      "rematch_mixed_jack",
      "rematch_mixed_kira",
    ]);
    const room = await setUpRoom([jack, kira], 4);

    gameOverOf(
      await driveHandToExchangeOrOver([jack, kira], () => {
        jack.socket.emit("room:start", { fillWithBots: true });
      })
    );
    const seatedBefore = __testables.seatedUsers(room.roomId);

    const deals = [jack, kira].map((c) => waitForDeal(c.socket));
    jack.socket.emit("game:rematch_vote");
    kira.socket.emit("game:rematch_vote");
    const [jackState, kiraState] = await Promise.all(deals);

    for (const state of [jackState, kiraState]) {
      // Dropping the two bot seats would leave a 2-seat table scoring 1/0
      // while cumulativeScores and matchTarget carried on from a 3/2/1/0 match.
      assert.equal(state.players.length, 4, "a bot seat must not be dropped by the rematch");
      assert.equal(state.players.filter((p) => p.type === "ai").length, 2);
      assertHandSecrecy(state, "mixed rematch deal");
    }
    assert.notEqual(
      jackState.viewerSeatIndex,
      kiraState.viewerSeatIndex,
      "two humans must not be told they hold the same seat"
    );
    assert.deepEqual(
      __testables.seatedUsers(room.roomId),
      seatedBefore,
      "seat numbering must not change across a manche"
    );
    await closeTable(room.roomId, jack);
  });

  test("a rematch that cannot proceed says why and leaves the vote retryable", async () => {
    const [liam] = await makeClients(server, ["rematch_error_liam"]);
    const room = await setUpRoom([liam], 2);

    // `matchLength: "single"` ends the match with the very first manche, so the
    // table has to have *answered* the rematch question before it may deal
    // again — the one bail-out reachable without corrupting server state.
    gameOverOf(
      await driveHandToExchangeOrOver([liam], () => {
        liam.socket.emit("room:start", { fillWithBots: true, matchLength: "single" });
      })
    );

    const refused = waitFor<{ code: string }>(liam.socket, "game:error", 5_000);
    liam.socket.emit("game:rematch_vote");
    assert.equal(
      (await refused).code,
      "REMATCH_DECLINED",
      "a bail-out must tell the player why instead of returning silently"
    );

    // Not a dead end: answering the question and voting again deals the next
    // manche, which a vote cleared on the way out of the bail-out could not do.
    const started = waitFor(liam.socket, "game:started", 8_000);
    liam.socket.emit("game:rematch_intent", { wants: true });
    liam.socket.emit("game:rematch_vote");
    await started;
    await closeTable(room.roomId, liam);
  });
});
