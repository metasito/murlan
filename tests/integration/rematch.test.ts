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
 * Shortened well below the 60s disconnect grace and 30s AFK production
 * defaults so a manche played out against bots finishes in about a second; the
 * bot's own pace comes from the harness. `server/socket.ts` reads these once at
 * module scope, so they must be
 * set before that module is first imported — this file always runs as its own
 * process under `node --test`, so the override never leaks into another test
 * file's process.
 */
process.env.MURLAN_AFK_TIMEOUT_MS = "300";

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
    const { hasActiveGame } = await import("../helpers/liveGame.ts");
    host.socket.emit("room:leave");
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (!hasActiveGame(roomId)) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.fail("the table was still live after its host left");
  }

  test("a lone human plus bots deals a second manche with the same seats", async () => {
    const { seatedUsers, matchSnapshot } = await import("../helpers/liveGame.ts");
    const [ivan] = await makeClients(server, ["rematch_solo_ivan"]);
    const room = await setUpRoom([ivan], 4);

    const over = gameOverOf(
      await driveHandToExchangeOrOver([ivan], () => {
        ivan.socket.emit("room:start", { fillWithBots: true, botPersonality: "gent" });
      })
    );
    const seatedBefore = seatedUsers(room.roomId);
    assert.deepEqual(seatedBefore, { 0: ivan.user.id });

    const dealt = waitForDeal(ivan.socket);
    const started = waitFor(ivan.socket, "game:started", 8_000);
    ivan.socket.emit("game:rematch_vote");
    const next = await dealt;
    await started;

    assert.equal(next.players.length, 4, "the next manche must keep every seat");
    assert.equal(
      matchSnapshot(room.roomId)?.dealFirstSeat,
      1,
      "the second manche deals one seat further round, so the extra cards move"
    );
    assert.equal(next.players.filter((p) => p.type === "ai").length, 3);
    assertHandSecrecy(next, "solo rematch deal");
    // A seat with no playerMap entry is exactly what armTurn drives with the
    // AI, so this is the assertion that the three bot seats are still bots and
    // that the human's seat did not move under him.
    assert.deepEqual(
      seatedUsers(room.roomId),
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
    const { seatedUsers } = await import("../helpers/liveGame.ts");
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
    const seatedBefore = seatedUsers(room.roomId);

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
      seatedUsers(room.roomId),
      seatedBefore,
      "seat numbering must not change across a manche"
    );
    await closeTable(room.roomId, jack);
  });

  /**
   * `handleGameOver` sets `rooms.status = "finished"` after every manche, not
   * only at the end of a match, so the room row alone cannot tell a running
   * match from an ended one. Accepting room:start on that status is a second
   * deal path: it deals with `initializeGame` (no exchange phase, so the
   * loser never forfeits their strongest card) and takes `matchLength`
   * straight from the payload while the running match's scores and target
   * carry on.
   */
  test("room:start cannot deal the next manche of a running match", async () => {
    const { matchSnapshot } = await import("../helpers/liveGame.ts");
    const [mira] = await makeClients(server, ["newmatch_running_mira"]);
    const room = await setUpRoom([mira], 4);

    const over = gameOverOf(
      await driveHandToExchangeOrOver([mira], () => {
        mira.socket.emit("room:start", { fillWithBots: true, botPersonality: "gent" });
      })
    );
    const before = matchSnapshot(room.roomId);
    assert.equal(before?.matchOver, false, "one manche of a 21-point match settles nothing");

    const refused = waitFor<{ code: string }>(mira.socket, "room:error", 5_000);
    // The payload a losing host would send: convert the match into a one-hand
    // shootout and re-deal it without the exchange.
    mira.socket.emit("room:start", { fillWithBots: true, matchLength: "single" });
    assert.equal((await refused).code, "MATCH_IN_PROGRESS");
    assert.deepEqual(
      matchSnapshot(room.roomId),
      before,
      "a refused room:start must leave the format, target, scores and hand exactly as they were"
    );

    // The one path that may deal it, still dealing it properly.
    const dealt = waitForDeal(mira.socket);
    mira.socket.emit("game:rematch_vote");
    const next = await dealt;
    assert.ok(next.exchangePhase, "the next manche of a running match carries an exchange phase");
    assert.equal(next.players[next.exchangePhase.winnerIdx].id, over.rankings[0]);
    await closeTable(room.roomId, mira);
  });

  test("a new match after the last one needs the table, not just the host", async () => {
    const [nadia, omar] = await makeClients(server, [
      "newmatch_gate_nadia",
      "newmatch_gate_omar",
    ]);
    const room = await setUpRoom([nadia, omar], 2);

    // `matchLength: "single"` ends the match with the first manche, so what
    // follows is a genuinely new match rather than the next hand of this one.
    gameOverOf(
      await driveHandToExchangeOrOver([nadia, omar], () => {
        nadia.socket.emit("room:start", { matchLength: "single" });
      })
    );

    const refused = waitFor<{ code: string }>(nadia.socket, "room:error", 5_000);
    nadia.socket.emit("room:start");
    assert.equal(
      (await refused).code,
      "NEW_MATCH_NOT_READY",
      "the host alone cannot commit the other seat to another match"
    );

    // A seat nobody holds abstains rather than blocking: the gate counts the
    // seats in playerMap, and Omar's is no longer one of them.
    const takeover = waitFor(nadia.socket, "game:seat_bot_takeover", 5_000);
    omar.socket.emit("room:leave");
    await takeover;

    const started = waitFor(nadia.socket, "game:started", 8_000);
    const dealt = waitForDeal(nadia.socket);
    nadia.socket.emit("room:start", { fillWithBots: true });
    await started;
    const next = await dealt;
    assert.equal(next.players.length, 2, "the new match deals a full table");
    assertHandSecrecy(next, "new match deal");
    await closeTable(room.roomId, nadia);
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
  test("an AFK exchange is announced as an exchange, not as a pass", async () => {
    const [pia, quinn] = await makeClients(server, [
      "afk_exchange_pia",
      "afk_exchange_quinn",
    ]);
    const room = await setUpRoom([pia, quinn], 2);

    gameOverOf(
      await driveHandToExchangeOrOver([pia, quinn], () => {
        pia.socket.emit("room:start");
      })
    );

    /** Votes another manche in and returns the deal both seats were sent. */
    const dealNextManche = async () => {
      const dealt = waitForDeal(pia.socket);
      pia.socket.emit("game:rematch_vote");
      quinn.socket.emit("game:rematch_vote");
      return dealt;
    };

    // A loser holding both jokers skips the exchange entirely (docs/RULES.md
    // §10), and in a two-handed deal that is one manche in four — play those
    // out and deal again rather than asserting on whichever one turns up.
    let next = await dealNextManche();
    for (let attempt = 0; attempt < 6 && !next.exchangePhase?.active; attempt++) {
      gameOverOf(
        await driveHandToExchangeOrOver([pia, quinn], () => {}, { stopOnExchange: false })
      );
      next = await dealNextManche();
    }
    assert.ok(next.exchangePhase?.active, "the next manche opens on an exchange");

    // Registered only now: an AFK auto-pass from any manche played above would
    // otherwise be the first code seen and would pass this test for the wrong
    // reason.
    const afk: string[] = [];
    pia.socket.on("game:notification", (payload: { code?: string }) => {
      if (payload?.code?.startsWith("PLAYER_AFK_AUTO_")) afk.push(payload.code);
    });

    const deadline = Date.now() + 5_000;
    while (afk.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(
      afk[0],
      "PLAYER_AFK_AUTO_EXCHANGE",
      "the exchange winner's timer hands over a card, so announcing a pass tells every seat the wrong thing"
    );
    await closeTable(room.roomId, pia);
  });
});
