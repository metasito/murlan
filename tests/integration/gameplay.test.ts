import { test, before, after, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { io as ioClient, type Socket } from "socket.io-client";
import { logger } from "../../server/logger.ts";
import { createDeck } from "../../lib/gameEngine.ts";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { register, waitFor } from "../helpers/client.ts";
import {
  assertHandSecrecy,
  driveHandToExchangeOrOver,
  makeClients as makeClientsOn,
  setUpRoom,
  startGame,
  type Client,
  type RoomState,
  type SanitizedState,
} from "../helpers/table.ts";

/**
 * Shortened well below the 60s disconnect grace / 30s AFK / 1.2s bot-move
 * production defaults, and the per-user game-action rate limit raised past
 * anything this file can spend, so the tests below don't stall on real-world
 * timer lengths or get throttled replaying several hands down one socket.
 * `server/socket.ts` reads all four once at module scope, so they must be set
 * before that module is first imported — this file always runs as its own
 * process under `node --test`, so the override never leaks into another test
 * file's process.
 *
 * The rate limit is derived rather than raised until the flake stopped. The
 * exchange test below drives at most 21 hands down one socket (its opening
 * hand plus the loop's own 20 attempts), a heads-up hand deals 21 cards a
 * side, and a client emits at most one game action a turn — so 882 is the
 * most this file can reach inside one 60s window, against a measured 12–15 a
 * hand. The alternatives lose: resetting the bucket between hands means a
 * test-only export from server/socket.ts, which is a bypass shipped next to
 * the guard it bypasses; replaying fewer hands trades this for the spurious
 * failure the loop's bound exists to make negligible. Nothing here asserts
 * the limiter — tests/socketRateLimit.test.ts does, per account, in its own
 * process.
 */
process.env.MURLAN_AFK_TIMEOUT_MS = "300";
process.env.MURLAN_DISCONNECT_GRACE_MS = "500";
process.env.MURLAN_BOT_MOVE_DELAY_MS = "20";
process.env.MURLAN_GAME_ACTION_RATE_LIMIT = "1200";

describe("gameplay integrity", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    await server.stop();
  });

  const makeClients = (usernames: string[]) => makeClientsOn(server, usernames);

  // ── Test 0 ──────────────────────────────────────────────────────────────

  /**
   * Regression test for a startup race in the connection handler: it used
   * to `await storage.getFriends(userId)` (a real DB round-trip) before
   * registering any of the room:* / game:* listeners. An event emitted the
   * instant the client sees "connect" could land in that window and be
   * silently dropped — no error, no ack, nothing. This is exactly how the
   * app's own reconnect path behaves (OnlineGameContext fires game:rejoin
   * from its own "connect" handler), so a slow DB round-trip on a real
   * reconnect could strand a player with no way back into their game.
   *
   * This test builds its socket by hand rather than calling connectAs(), so
   * that no helper can paper over a regression by waiting for some later
   * server-sent event before handing the socket back.
   */
  test("an event emitted on the client's own connect handler is not dropped", async () => {
    const { user, cookie } = await register(server, "connect_race_user");
    const ticketRes = await fetch(`${server.url}/api/auth/socket-ticket`, {
      method: "POST",
      headers: { cookie },
    });
    const ticketText = await ticketRes.text();
    assert.equal(ticketRes.status, 200, ticketText);
    const { ticket } = JSON.parse(ticketText) as { ticket: string };

    const socket: Socket = ioClient(server.url, {
      auth: { ticket },
      transports: ["websocket"],
      reconnection: false,
    });
    try {
      const response = waitFor<RoomState>(socket, "room:state", 3_000);
      // Fired synchronously from within the "connect" handler itself —
      // no waiting for any other server event first, matching how
      // OnlineGameContext's attemptRejoin() fires game:rejoin on reconnect.
      socket.once("connect", () => {
        socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
      });
      const state = await response;
      assert.ok(state.roomId, "room:create emitted on connect must still get a reply");
      assert.equal(state.hostUserId, user.id);
    } finally {
      socket.close();
    }
  });

  // ── Test 1 ──────────────────────────────────────────────────────────────

  test("a player never receives another player's hand", async () => {
    const [alice, bob] = await makeClients([
      "hand_secrecy_alice",
      "hand_secrecy_bob",
    ]);
    await setUpRoom([alice, bob], 2);
    const [aliceState, bobState] = await startGame([alice, bob]);

    for (const state of [aliceState, bobState]) {
      assertHandSecrecy(state, "opening deal");
    }
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────

  test("play and pass are rejected during an active exchange phase", async () => {
    const [alice, bob] = await makeClients(["exchange_alice", "exchange_bob"]);
    const room = await setUpRoom([alice, bob], 2);

    // The very first hand never carries an exchange phase — only a rematch,
    // seeded from the previous hand's winner/loser, does. Play it out with
    // forced-minimum moves to reach game:over.
    const opening = await driveHandToExchangeOrOver([alice, bob], () => {
      alice.socket.emit("room:start");
    });
    assert.equal(opening.stoppedOn, "gameOver");

    // Reaching an exchange is probabilistic: when the loser holds both jokers
    // (docs/RULES.md §10) no card is owed back and the hand runs straight to
    // game:over. Heads-up that is (21/54)·(20/53) = 14.7% per hand, so the
    // expected number of attempts is ~1.2 and the cap only bites in the tail —
    // raising it is close to free in runtime and takes the odds of a spurious
    // failure from 1e-3% at 6 attempts to 2.1e-15% at 20.
    //
    // The alternative — dealing the loser a stacked hand — is deliberately not
    // taken. It would mean a seam that rigs the deal in a server whose entire
    // model is that the server alone decides what the cards are, and no test
    // is worth putting that seam within reach of production.
    let exchange: Map<Client, SanitizedState> | null = null;
    for (let attempt = 0; attempt < 20 && !exchange; attempt++) {
      const result = await driveHandToExchangeOrOver([alice, bob], () => {
        alice.socket.emit("game:rematch_vote");
        bob.socket.emit("game:rematch_vote");
      });
      if (result.stoppedOn === "exchange") {
        exchange = result.states;
      }
    }
    assert.ok(exchange, "never reached an active exchange phase after several rematches");

    const anyState = [...exchange.values()][0];
    const phase = anyState.exchangePhase!;
    assert.equal(phase.active, true);

    const winnerName = anyState.players[phase.winnerIdx].name;
    const winner = [alice, bob].find((c) => c.user.username === winnerName);
    assert.ok(winner, "could not map the exchange winner's seat back to a client");
    const winnerState = exchange.get(winner!)!;
    const handBefore = winnerState.players[phase.winnerIdx].hand;
    assert.ok(handBefore.length > 0, "the exchange winner's own hand must be visible to them");

    const playRejected = waitFor<{ code: string }>(winner!.socket, "game:error");
    winner!.socket.emit("game:play", { cardIds: [handBefore[0].id] });
    const playErr = await playRejected;
    assert.equal(playErr.code, "EXCHANGE_PENDING");

    const passRejected = waitFor<{ code: string }>(winner!.socket, "game:error");
    winner!.socket.emit("game:pass");
    const passErr = await passRejected;
    assert.equal(passErr.code, "EXCHANGE_PENDING");

    // The rejection must not just fail to reply — re-fetch the authoritative
    // state (game:rejoin is a safe, idempotent read) and confirm the
    // winner's hand and the exchange phase are byte-for-byte unchanged.
    const freshState = waitFor<SanitizedState>(winner!.socket, "game:state");
    winner!.socket.emit("game:rejoin", { roomId: room.roomId });
    const fresh = await freshState;
    assert.equal(fresh.exchangePhase?.active, true);
    assert.deepEqual(
      fresh.players[phase.winnerIdx].hand.map((c) => c.id),
      handBefore.map((c) => c.id)
    );
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────

  test("a malformed payload on any event does not kill the process", async () => {
    const [alice] = await makeClients(["malformed_alice"]);

    const playErr = waitFor<{ message: string }>(alice.socket, "game:error");
    alice.socket.emit("game:play", 42);
    await playErr;

    const reactionErr = waitFor<{ message: string }>(alice.socket, "game:error");
    alice.socket.emit("game:reaction");
    await reactionErr;

    const joinErr = waitFor<{ message: string }>(alice.socket, "room:error");
    alice.socket.emit("room:join", { code: 12345 });
    await joinErr;

    // If any of the malformed payloads above had thrown inside the handler
    // uncontained, the whole process — every table on the server, not just
    // this socket — would be dead, and this would simply hang or reject.
    const created = waitFor<RoomState>(alice.socket, "room:state");
    alice.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
    const state = await created;
    assert.ok(state.roomId, "room:create must still succeed after malformed payloads");
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────

  test("a vacated seat does not deadlock the table", async () => {
    const [alice, bob, carol] = await makeClients([
      "vacancy_alice",
      "vacancy_bob",
      "vacancy_carol",
    ]);
    await setUpRoom([alice, bob, carol], 3);
    await startGame([alice, bob, carol]);

    // bob hard-disconnects mid-game — no room:leave, just the socket going
    // away, exactly like a dropped connection.
    const disconnectNotice = waitFor<{ userId: string }>(
      alice.socket,
      "game:player_disconnected",
      5_000
    );
    bob.socket.disconnect();
    await disconnectNotice;

    // Past the shortened grace period the seat must be handed to a bot
    // instead of stalling the table: the seat must be removed from
    // playerMap AND marked AI-controlled together, or play deadlocks the
    // moment the turn comes back around to it.
    const takeover = await waitFor<{ seatIndex: number }>(
      alice.socket,
      "game:seat_bot_takeover",
      5_000
    );
    const vacatedSeat = takeover.seatIndex;

    // alice and carol are left idle too (no explicit moves below), so every
    // further turn — including the bot's — has to run on the shortened
    // AFK/bot timers. Collect state broadcasts until the bot-controlled
    // vacated seat has actually played and the turn has moved on to someone
    // else: proof the table kept advancing instead of freezing on the empty
    // seat.
    let sawVacatedSeatAct = false;
    let sawTurnPastVacatedSeat = false;
    for (let i = 0; i < 10 && !(sawVacatedSeatAct && sawTurnPastVacatedSeat); i++) {
      const state = await waitFor<SanitizedState>(alice.socket, "game:state", 8_000);
      if (state.gameOver) break;
      if (state.lastPlayedBy === vacatedSeat) sawVacatedSeatAct = true;
      if (sawVacatedSeatAct && state.currentTurnIndex !== vacatedSeat) {
        sawTurnPastVacatedSeat = true;
      }
    }
    assert.ok(sawVacatedSeatAct, "the bot-controlled vacated seat never got to act");
    assert.ok(sawTurnPastVacatedSeat, "the turn never advanced past the vacated seat");
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────

  test("room:start with fillWithBots seats bots in the empty seats and the turn arbiter drives them", async () => {
    const [alice] = await makeClients(["botfill_alice"]);
    await setUpRoom([alice], 3);

    const opening = waitFor<SanitizedState>(alice.socket, "game:state");
    alice.socket.emit("room:start", { fillWithBots: true, botDifficulty: "easy" });
    const state = await opening;

    // One human seat, two bot seats — the same buildSeatRoster contract
    // tested in isolation by tests/botFill.test.ts, now exercised through
    // the real room:start handler.
    assert.equal(state.players.length, 3);
    assert.equal(state.players.filter((p) => p.type === "ai").length, 2);
    assert.equal(state.players.filter((p) => p.type === "human").length, 1);

    // Bots must be driven by the same turn arbiter the disconnect-takeover
    // path uses — not a second bot loop — so this proves a bot seat
    // actually plays and the turn advances past it, exactly like the
    // vacated-seat test above.
    let sawBotAct = false;
    let sawTurnPastBot = false;
    let actedBotSeat = -1;
    for (let i = 0; i < 15 && !(sawBotAct && sawTurnPastBot); i++) {
      const s = await waitFor<SanitizedState>(alice.socket, "game:state", 8_000);
      if (s.gameOver) break;
      const actor = s.players[s.lastPlayedBy];
      if (actor?.type === "ai") {
        sawBotAct = true;
        actedBotSeat = s.lastPlayedBy;
      }
      if (sawBotAct && s.currentTurnIndex !== actedBotSeat) {
        sawTurnPastBot = true;
      }
    }
    assert.ok(sawBotAct, "no bot seat ever played");
    assert.ok(sawTurnPastBot, "the turn never advanced past a bot seat");
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────

  const LOG_LEVELS = ["info", "debug", "warn", "error"] as const;

  interface LoggedLine {
    level: (typeof LOG_LEVELS)[number];
    args: unknown[];
  }

  /**
   * `${rank}_${suit}`, plus the two jokers — the shape createDeck gives every
   * card id. A log line carrying one of these is leaking a hand.
   */
  const CARD_ID = /^(?:[2-9]|10|[JQKA])_(?:hearts|diamonds|clubs|spades)$|^joker_(?:bw|colored)$/;

  function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null;
  }

  /** Every `key: value` pair reachable from a logged argument. */
  function* walk(value: unknown, key = ""): Generator<[string, unknown]> {
    yield [key, value];
    if (!isRecord(value)) return;
    if (Array.isArray(value)) {
      for (const item of value) yield* walk(item, key);
      return;
    }
    for (const [k, v] of Object.entries(value)) yield* walk(v, k);
  }

  /**
   * A disputed result has to be reconstructable from the log, and the price of
   * that must never be a hand appearing in it. Both halves are asserted over
   * the same run: the outcome line has to be there exactly once, and nothing
   * logged at any level — the per-play debug line included — may name a card.
   */
  test("a finished hand logs its outcome once, and no log line carries a card", async () => {
    const [alice, bob] = await makeClients(["outcome_log_alice", "outcome_log_bob"]);
    const room = await setUpRoom([alice, bob], 2);

    // pino's level setter swaps every disabled level method for `noop`, so the
    // level has to be raised *before* the spies go on: setting it afterwards
    // would overwrite them.
    const previousLevel = logger.level;
    logger.level = "debug";
    const lines: LoggedLine[] = [];
    for (const level of LOG_LEVELS) {
      mock.method(logger, level, (...args: unknown[]) => {
        lines.push({ level, args });
      });
    }

    try {
      const result = await driveHandToExchangeOrOver([alice, bob], () => {
        alice.socket.emit("room:start");
      });
      assert.equal(result.stoppedOn, "gameOver");
      // No wait: handleGameOver logs the outcome in the same synchronous block
      // as the `game:over` emit, and the client's callback cannot run before
      // that block returns.
    } finally {
      mock.restoreAll();
      logger.level = previousLevel;
    }

    const ours = lines.filter(
      (l) => isRecord(l.args[0]) && l.args[0].roomId === room.roomId
    );

    const outcomes = ours.filter((l) => {
      const payload = l.args[0] as Record<string, unknown>;
      return "rankings" in payload && "matchWinners" in payload;
    });
    assert.equal(
      outcomes.length,
      1,
      `expected exactly one outcome line for room ${room.roomId}, got ${outcomes.length}`
    );
    const outcome = outcomes[0].args[0] as Record<string, unknown>;
    assert.equal(outcomes[0].level, "info");
    assert.ok(Array.isArray(outcome.rankings) && outcome.rankings.length === 2);
    assert.ok(isRecord(outcome.cumulative), "the running scoreboard must be logged");
    assert.equal(outcome.matchLength, "match");

    const plays = ours.filter(
      (l) => l.level === "debug" && isRecord(l.args[0]) && "comboType" in l.args[0]
    );
    assert.ok(
      plays.length > 0,
      "no per-play debug line was observed — the card-leak check below would be vacuous"
    );
    for (const play of plays) {
      const payload = play.args[0] as Record<string, unknown>;
      assert.equal(typeof payload.cardCount, "number");
      assert.equal(typeof payload.seat, "number");
    }

    const leaks: string[] = [];
    for (const line of lines) {
      for (const arg of line.args) {
        for (const [key, value] of walk(arg)) {
          if (key === "hand" || key === "hands" || key === "cards") {
            leaks.push(`${line.level}: key "${key}"`);
          }
          if (typeof value === "string" && CARD_ID.test(value)) {
            leaks.push(`${line.level}: card id "${value}" under "${key}"`);
          }
        }
      }
    }
    assert.deepEqual(
      leaks,
      [],
      `a hand must never be logged, at any level:\n${leaks.join("\n")}`
    );
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────

  /**
   * Records every occurrence of `event` for the life of the test, for
   * assertions about an event that must *never* arrive. The returned array is
   * the live one the listener pushes into: read it at assertion time. Copying
   * it earlier (spreading two of them into one array, say) snapshots it while
   * it is still empty, and the assertion can then never fail.
   */
  function collect(client: Client, event: string): unknown[] {
    const seen: unknown[] = [];
    client.socket.on(event, (payload: unknown) => seen.push(payload));
    return seen;
  }

  /** Polls a server-side predicate that no socket event announces. */
  async function waitUntil(
    predicate: () => boolean,
    message: string,
    ms = 5_000
  ): Promise<void> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.fail(message);
  }

  /** Plays the opening hand of a fresh room out to `game:over`. */
  async function playOpeningHand(clients: Client[]): Promise<void> {
    const result = await driveHandToExchangeOrOver(clients, () => {
      clients[0].socket.emit("room:start");
    });
    assert.equal(result.stoppedOn, "gameOver");
  }

  /**
   * `rooms.status` is set to "finished" after every manche, not only at the end
   * of a match, so it cannot tell a table that is waiting to deal again from
   * one that is over. Nothing else removes a seat between hands and the
   * unanimous ready gate counts seats, so the seat has to be freed here or one
   * player tapping "Torna alla lobby" blocks the next manche for everyone else.
   */
  test("a player leaving at the results screen frees the seat and the table plays on", async () => {
    const [alice, bob, carol] = await makeClients([
      "results_leave_alice",
      "results_leave_bob",
      "results_leave_carol",
    ]);
    await setUpRoom([alice, bob, carol], 3);
    await playOpeningHand([alice, bob, carol]);

    // The hazard this fix has to avoid: `game:player_left` drives the client's
    // blocking "Partita interrotta" teardown, which would eject both survivors
    // from a table the server is about to restart.
    const bobTeardowns = collect(bob, "game:player_left");
    const carolTeardowns = collect(carol, "game:player_left");

    const takeover = waitFor<{ userId: string; seatIndex: number }>(
      bob.socket,
      "game:seat_bot_takeover"
    );
    const voteState = waitFor<{ votes: string[]; total: number }>(
      carol.socket,
      "game:vote_state"
    );
    alice.socket.emit("room:leave");

    const seatFreed = await takeover;
    assert.equal(seatFreed.userId, alice.user.id);
    const votes = await voteState;
    assert.equal(votes.total, 2, "the ready gate must only count the seats still held");
    assert.deepEqual(votes.votes, []);
    assert.deepEqual(
      [...bobTeardowns, ...carolTeardowns],
      [],
      "a between-hands leave must not fire the client's game-interrupted teardown"
    );

    const started = [bob, carol].map((c) =>
      waitFor(c.socket, "game:started", 8_000)
    );
    const matchState = waitFor<{ target: number }>(
      bob.socket,
      "game:match_state",
      8_000
    );
    bob.socket.emit("game:rematch_vote");
    carol.socket.emit("game:rematch_vote");
    await Promise.all(started);
    assert.ok((await matchState).target > 0);
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────

  test("a hard disconnect at the results screen frees the seat with no grace period", async () => {
    const [dave, erin, frank] = await makeClients([
      "results_drop_dave",
      "results_drop_erin",
      "results_drop_frank",
    ]);
    await setUpRoom([dave, erin, frank], 3);
    await playOpeningHand([dave, erin, frank]);

    const erinTeardowns = collect(erin, "game:player_left");
    const frankTeardowns = collect(frank, "game:player_left");
    // Nobody is mid-turn between hands, so there is nothing to hold a grace
    // period open for — the seat is freed on the disconnect itself.
    const graceNotices = collect(erin, "game:player_disconnected");

    const takeover = waitFor<{ userId: string }>(
      erin.socket,
      "game:seat_bot_takeover",
      5_000
    );
    dave.socket.disconnect();
    assert.equal((await takeover).userId, dave.user.id);
    assert.deepEqual(
      [...erinTeardowns, ...frankTeardowns],
      [],
      "a drop at the results screen must not fire the client's game-interrupted teardown"
    );
    assert.deepEqual(graceNotices, []);

    const started = [erin, frank].map((c) =>
      waitFor(c.socket, "game:started", 8_000)
    );
    erin.socket.emit("game:rematch_vote");
    frank.socket.emit("game:rematch_vote");
    await Promise.all(started);
  });

  // ── Test 9 ──────────────────────────────────────────────────────────────

  test("the last player leaving the results screen disposes the room", async () => {
    const { hasActiveGame } = await import("../helpers/liveGame.ts");
    const [gina, hugo] = await makeClients([
      "results_dispose_gina",
      "results_dispose_hugo",
    ]);
    const room = await setUpRoom([gina, hugo], 2);
    await playOpeningHand([gina, hugo]);

    assert.equal(hasActiveGame(room.roomId), true);

    const takeover = waitFor(hugo.socket, "game:seat_bot_takeover");
    gina.socket.emit("room:leave");
    await takeover;
    assert.equal(
      hasActiveGame(room.roomId),
      true,
      "a table with a seat still held must survive"
    );

    // The last leaver's own socket has already left the room, so the disposal
    // is announced to nobody — it is only observable on the server.
    hugo.socket.emit("room:leave");
    await waitUntil(
      () => !hasActiveGame(room.roomId),
      "the room kept a live game in memory after its last seat emptied"
    );
  });

  // ── Tests 10-12: the server-authority checks ────────────────────────────

  /**
   * Card ids are fully deterministic — `${rank}_${suit}` plus the two jokers
   * — so every client already knows every id that can exist without ever
   * seeing another hand. These three guards are the whole integrity half of
   * the trust boundary. A `game:error` says the move was refused; it does not
   * say the table stayed put, so every case also asserts the authoritative
   * state — `game:rejoin` is an idempotent read, so a round-trip through it
   * proves nothing moved.
   */
  async function authoritativeState(client: Client, roomId: string): Promise<SanitizedState> {
    const fresh = waitFor<SanitizedState>(client.socket, "game:state");
    client.socket.emit("game:rejoin", { roomId });
    return fresh;
  }

  test("a player cannot play out of turn", async () => {
    const [alice, bob] = await makeClients(["out_of_turn_alice", "out_of_turn_bob"]);
    const room = await setUpRoom([alice, bob], 2);
    const states = await startGame([alice, bob]);

    const idle = [alice, bob].find(
      (_, i) => states[i].viewerSeatIndex !== states[i].currentTurnIndex
    );
    assert.ok(idle, "one of the two seats must not be on turn at the opening deal");
    const before = states[[alice, bob].indexOf(idle)];

    // Heads-up, the complement of your own hand *is* the opponent's, and the
    // start card is broadcast to everyone — so the idle seat can name a card
    // the seat on turn genuinely holds and forge a legal opening play from
    // it. The ownership guard passes it; only the turn guard stops it.
    const held = new Set(before.players[before.viewerSeatIndex].hand.map((c) => c.id));
    assert.ok(before.startCard && !held.has(before.startCard.id));

    idle.socket.emit("game:play", { cardIds: [before.startCard.id] });

    const after = await authoritativeState(idle, room.roomId);
    assert.equal(after.currentTurnIndex, before.currentTurnIndex);
    assert.deepEqual(
      after.players.map((p) => p.handCount),
      before.players.map((p) => p.handCount)
    );
  });

  test("a player cannot play a card they do not hold", async () => {
    const [alice, bob] = await makeClients(["not_held_alice", "not_held_bob"]);
    const room = await setUpRoom([alice, bob], 2);
    const states = await startGame([alice, bob]);

    const onTurn = [alice, bob].find(
      (_, i) => states[i].viewerSeatIndex === states[i].currentTurnIndex
    );
    assert.ok(onTurn, "somebody must be on turn at the opening deal");
    const before = states[[alice, bob].indexOf(onTurn)];
    const held = new Set(before.players[before.viewerSeatIndex].hand.map((c) => c.id));
    const foreign = createDeck().find((c) => !held.has(c.id));
    assert.ok(foreign, "a two-handed deal cannot exhaust the deck");
    assert.ok(before.startCard && held.has(before.startCard.id));

    // The play is *refused*, not narrowed to the cards the sender does hold.
    // `player.hand.filter(...)` would otherwise turn a forged two-card play
    // into a legal single and let it through as if it had been asked for.
    const rejected = waitFor<{ code: string }>(onTurn.socket, "game:error");
    onTurn.socket.emit("game:play", { cardIds: [before.startCard.id, foreign.id] });
    assert.equal((await rejected).code, "INVALID_CARD");

    const after = await authoritativeState(onTurn, room.roomId);
    assert.equal(after.currentTurnIndex, before.currentTurnIndex);
    assert.equal(after.firstPlayMade, false);
    assert.deepEqual(
      after.players.map((p) => p.handCount),
      before.players.map((p) => p.handCount)
    );
  });

  test("the opening play must contain the start card", async () => {
    const [alice, bob] = await makeClients(["start_card_alice", "start_card_bob"]);
    const room = await setUpRoom([alice, bob], 2);
    const states = await startGame([alice, bob]);

    const onTurn = [alice, bob].find(
      (_, i) => states[i].viewerSeatIndex === states[i].currentTurnIndex
    );
    assert.ok(onTurn, "somebody must be on turn at the opening deal");
    const before = states[[alice, bob].indexOf(onTurn)];
    assert.equal(before.firstPlayMade, false);
    assert.ok(before.startCard, "the opening deal must name a start card");

    const other = before.players[before.viewerSeatIndex].hand.find(
      (c) => c.id !== before.startCard!.id
    );
    assert.ok(other, "the seat on turn holds more than the start card");

    const rejected = waitFor<{ code: string }>(onTurn.socket, "game:error");
    onTurn.socket.emit("game:play", { cardIds: [other.id] });
    assert.equal((await rejected).code, "MUST_PLAY_START_CARD");

    const after = await authoritativeState(onTurn, room.roomId);
    assert.equal(after.firstPlayMade, false);
    assert.deepEqual(
      after.players.map((p) => p.handCount),
      before.players.map((p) => p.handCount)
    );
  });

  // ── Test 13 ─────────────────────────────────────────────────────────────

  /**
   * The verdict itself is pinned over synthetic tables in
   * tests/socketHandFlags.test.ts ("a seat that never answered counts as a no
   * but still counts toward total"). What only the live path can show is that
   * the broadcast tally agrees with it — the figures the results screen reads.
   */
  test("a seat that never answers the rematch counts as a no", async () => {
    const [alice, bob] = await makeClients(["silent_rematch_alice", "silent_rematch_bob"]);
    await setUpRoom([alice, bob], 2);

    const opening = await driveHandToExchangeOrOver([alice, bob], () => {
      alice.socket.emit("room:start");
    });
    assert.equal(opening.stoppedOn, "gameOver");

    const tally = waitFor<{ yes: number; total: number }>(
      bob.socket,
      "game:rematch_intents"
    );
    alice.socket.emit("game:rematch_intent", { wants: true });
    const { yes, total } = await tally;
    assert.deepEqual({ yes, total }, { yes: 1, total: 2 });
  });
});
