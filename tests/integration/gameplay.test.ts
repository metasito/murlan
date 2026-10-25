import { test, before, after, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { io as ioClient, type Socket } from "socket.io-client";
import { PROTOCOL_AUTH, reconnectAs, register, waitFor, waitForWhere } from "../helpers/client.ts";
import { eq } from "drizzle-orm";
import { logger } from "../../server/shared/logger.ts";
import { payload } from "../../server/shared/payload.ts";
import { createDeck, getAllValidPlays } from "../../lib/game/gameEngine.ts";
import { intentSeq } from "../../lib/game/moves.ts";
import type { ServerPayload } from "../../shared/protocol.ts";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { lobbyGraceMs } from "../../server/game/gameTimers.ts";
import {
  assertHandSecrecy,
  driveRoundToExchangeOrOver,
  makeClients as makeClientsOn,
  setUpRoom,
  startGame,
  type Client,
  type RoomState,
  type SanitizedState,
} from "../helpers/table.ts";
import { friendStore } from "../../server/store/friendStore.ts";
import { disposeGame } from "../../server/game/gamePersistence.ts";
import { db } from "../../server/store/db.ts";
import { redealExactly, seatedUsers, hasActiveGame } from "../helpers/liveGame.ts";
import { activeGames as activeGamesTable } from "../../shared/schema.ts";

/**
 * Shortened well below the 60s disconnect grace and 30s AFK production
 * defaults, so the tests below don't stall on real-world timer lengths. The
 * bot's own pace comes from the harness. `node --test` gives this file its own
 * process, so the override never leaks into another test file.
 */
process.env.MURLAN_AFK_TIMEOUT_MS = "300";
process.env.MURLAN_DISCONNECT_GRACE_MS = "500";
process.env.MURLAN_LOBBY_GRACE_MS = "700";

/**
 * Asked of the server rather than restated, so a grace this file cannot
 * actually shorten shows up as its own deadline moving with it.
 */
const LOBBY_GRACE_MS = lobbyGraceMs();

describe("gameplay integrity", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    await server.stop();
  });

  const makeClients = (usernames: string[]) => makeClientsOn(server, usernames);

  const refusal = (client: Client, event: string, ...args: unknown[]) =>
    client.socket.timeout(5_000).emitWithAck(event, ...args) as Promise<{ ok: boolean; code?: string }>;

  // ── Test 0 ──────────────────────────────────────────────────────────────

  /**
   * Regression test for a startup race in the connection handler: it used
   * to `await friendStore.getFriends(userId)` (a real DB round-trip) before
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

    // The handler's first await is this read. Held until the reply arrives, an
    // await moved above the registrations fails every run, not only on a slow database.
    const realGetFriends = friendStore.getFriends;
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let gated = false;
    friendStore.getFriends = async function (userId: string) {
      if (userId === user.id && !gated) {
        gated = true;
        await gate;
      }
      return realGetFriends.call(this, userId);
    };

    const probes: Record<string, [event: string, ...args: unknown[]]> = {
      registerRoomHandlers: ["room:create", { gameMode: "free_for_all", maxPlayers: 2 }],
      registerGameplayHandlers: ["game:rejoin", { roomId: "no-such-room" }],
      registerFriendHandlers: ["friend:get_online_list"],
    };
    const socketSource = readFileSync(new URL("../../server/socket/socket.ts", import.meta.url), "utf8");
    const groups = [...socketSource.matchAll(/\b(register\w+Handlers)\(ctx\)/g)].map((m) => m[1]);
    assert.deepEqual(groups.toSorted(), Object.keys(probes).toSorted(), "each handler group needs a probe");

    const socket: Socket = ioClient(server.url, {
      auth: { ...PROTOCOL_AUTH, ticket },
      transports: ["websocket"],
      reconnection: false,
    });
    try {
      const response = waitFor<RoomState>(socket, "room:state", 3_000);
      // Fired synchronously from within the "connect" handler itself —
      // no waiting for any other server event first, matching how
      // OnlineGameContext's attemptRejoin() fires game:rejoin on reconnect.
      const answers = new Promise<Record<string, unknown>[]>((resolve, reject) => {
        socket.once("connect", () => {
          Promise.all(
            groups.map((group) => socket.timeout(3_000).emitWithAck(...probes[group]!) as Promise<Record<string, unknown>>)
          ).then(resolve, reject);
        });
      });
      const state = await response;
      assert.ok(state.roomId, "room:create emitted on connect must still get a reply");
      assert.equal(state.hostUserId, user.id);
      // answerUnknownEvents answers an event nothing was listening for yet as CLIENT_OUTDATED.
      const unheard = (await answers).flatMap((a, i) => (a.code === "CLIENT_OUTDATED" ? [groups[i]] : []));
      assert.deepEqual(unheard, [], "registered after the connection handler's first await");
    } finally {
      release();
      friendStore.getFriends = realGetFriends;
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
    await startGame([alice, bob]);

    // No Joker in either hand, so the loser cannot hold both and skip the exchange (docs/GAME-RULES.md §10).
    const deck = createDeck()
      .filter((card) => !card.isJoker)
      .map((card) => card.id);
    const exchange = new Map<Client, SanitizedState>();
    const dealt = Promise.all(
      [alice, bob].map(async (client) => {
        const state = await waitForWhere<SanitizedState>(client.socket, "game:state", (s) => s.exchangePhase?.kind === "open");
        exchange.set(client, state);
      })
    );
    assert.ok(
      redealExactly(server.rt, room.roomId, [deck.slice(0, 14), deck.slice(14, 28)], {
        opening: { kind: "exchange", winnerSeat: 0, loserSeat: 1 },
      })
    );
    await dealt;

    const anyState = [...exchange.values()][0];
    const phase = anyState.exchangePhase;
    assert.ok(phase?.kind === "open");

    const winnerName = anyState.players[phase.winnerIdx].name;
    const winner = [alice, bob].find((c) => c.user.username === winnerName);
    assert.ok(winner, "could not map the exchange winner's seat back to a client");
    const winnerState = exchange.get(winner!)!;
    const handBefore = winnerState.players[phase.winnerIdx].hand;
    assert.ok(handBefore.length > 0, "the exchange winner's own hand must be visible to them");

    const playRejected = waitFor<{ code: string }>(winner!.socket, "game:error");
    winner!.socket.emit("game:play", { cardIds: [handBefore[0].id], seq: intentSeq(winnerState) });
    const playErr = await playRejected;
    assert.equal(playErr.code, "EXCHANGE_PENDING");

    const passRejected = waitFor<{ code: string }>(winner!.socket, "game:error");
    winner!.socket.emit("game:pass", { seq: intentSeq(winnerState) });
    const passErr = await passRejected;
    assert.equal(passErr.code, "EXCHANGE_PENDING");

    // Heads-up, the loser can name a card the winner holds; only the seat check refuses it.
    const loser = [alice, bob].find((c) => c !== winner)!;
    const stolen = await refusal(loser, "game:exchange_give_card", { cardId: handBefore[0].id, seq: intentSeq(winnerState) });
    assert.equal(stolen.code, "NOT_YOUR_EXCHANGE");

    // The rejection must not just fail to reply — re-fetch the authoritative
    // state (game:rejoin is a safe, idempotent read) and confirm the
    // winner's hand and the exchange phase are byte-for-byte unchanged.
    const freshState = waitFor<SanitizedState>(winner!.socket, "game:state");
    winner!.socket.emit("game:rejoin", { roomId: room.roomId });
    const fresh = await freshState;
    assert.equal(fresh.exchangePhase?.kind, "open");
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
    // playerMap AND marked bot-controlled together, or play deadlocks the
    // moment the turn comes back around to it.
    const takeover = await waitFor<{ seatIndex: number }>(
      alice.socket,
      "game:seat_bot_takeover",
      5_000
    );
    const vacatedSeat = takeover.seatIndex;

    // alice and carol are left idle too (no explicit moves below), so every
    // further turn — including the bot's — has to run on the shortened
    // AFK/bot timers. Collect state broadcasts until the vacated seat's own
    // turn has come up and gone: proof the table kept advancing instead of
    // freezing on the empty seat. #850 clause 3 plays this seat at minimum
    // legal strength until the round ends, which passes far more often than
    // the old full-bot takeover did — a pass resolves the turn exactly as
    // well as a play, so it is the turn moving on that proves no deadlock,
    // not which of the two the seat chose.
    let sawVacatedSeatsTurn = false;
    let sawTurnPastVacatedSeat = false;
    for (let i = 0; i < 10 && !(sawVacatedSeatsTurn && sawTurnPastVacatedSeat); i++) {
      const state = await waitFor<SanitizedState>(alice.socket, "game:state", 8_000);
      if (state.roundOver) break;
      if (state.currentTurnIndex === vacatedSeat) sawVacatedSeatsTurn = true;
      if (sawVacatedSeatsTurn && state.currentTurnIndex !== vacatedSeat) {
        sawTurnPastVacatedSeat = true;
      }
    }
    assert.ok(sawVacatedSeatsTurn, "the bot-controlled vacated seat's turn never came up");
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
    // tested in isolation by tests/bots/botFill.test.ts, now exercised through
    // the real room:start handler.
    assert.equal(state.players.length, 3);
    assert.equal(state.players.filter((p) => p.type === "bot").length, 2);
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
      if (s.roundOver) break;
      const actor = s.players[s.lastPlayedBy];
      if (actor?.type === "bot") {
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
  test("a finished round logs its outcome once, and no log line carries a card", async () => {
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
      const result = await driveRoundToExchangeOrOver([alice, bob], () => {
        alice.socket.emit("room:start");
      });
      assert.equal(result.stoppedOn, "roundOver");
      // No wait: handleRoundOver logs the outcome in the same synchronous block
      // as the `game:round_over` emit, and the client's callback cannot run before
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
      return "finishingOrder" in payload && "matchWinners" in payload;
    });
    assert.equal(
      outcomes.length,
      1,
      `expected exactly one outcome line for room ${room.roomId}, got ${outcomes.length}`
    );
    const outcome = outcomes[0].args[0] as Record<string, unknown>;
    assert.equal(outcomes[0].level, "info");
    assert.ok(Array.isArray(outcome.finishingOrder) && outcome.finishingOrder.length === 2);
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

  /** Plays the opening round of a fresh room out to `game:round_over`. */
  async function playOpeningRound(clients: Client[]): Promise<void> {
    const result = await driveRoundToExchangeOrOver(clients, () => {
      clients[0].socket.emit("room:start");
    });
    assert.equal(result.stoppedOn, "roundOver");
  }

  /**
   * `rooms.status` is set to "finished" after every round, not only at the end
   * of a match, so it cannot tell a table that is waiting to deal again from
   * one that is over. Nothing else removes a seat between hands and the
   * unanimous ready gate counts seats, so the seat has to be freed here or one
   * player tapping "Torna alla lobby" blocks the next round for everyone else.
   */
  test("a player leaving at the results screen frees the seat and the table plays on", async () => {
    const [alice, bob, carol] = await makeClients([
      "results_leave_alice",
      "results_leave_bob",
      "results_leave_carol",
    ]);
    await setUpRoom([alice, bob, carol], 3);
    await playOpeningRound([alice, bob, carol]);

    // The hazard this fix has to avoid: `game:player_left` drives the client's
    // blocking "Match interrupted" teardown, which would eject both survivors
    // from a table the server is about to restart.
    const bobTeardowns = collect(bob, "game:player_left");
    const carolTeardowns = collect(carol, "game:player_left");

    const takeover = waitFor<{ userId: string; seatIndex: number }>(
      bob.socket,
      "game:seat_bot_takeover"
    );
    const voteState = waitForWhere<{ votes: string[]; total: number }>(
      carol.socket,
      "game:vote_state",
      (v) => v.total < 3
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
      "a between-rounds leave must not fire the client's game-interrupted teardown"
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

  /**
   * Between hands the seat is held under the *lobby* grace, not the disconnect
   * one: it counts towards the rematch gate, so the table cannot wait a full
   * minute on it, and it is a seat in a running match, so a blip cannot cost
   * it outright.
   *
   * Nothing is broadcast while it is held. A player who comes back inside the
   * window was never away as far as the rest of the room is concerned.
   */
  test("a hard disconnect at the results screen holds the seat, then frees it", async () => {
    const [dave, erin, frank] = await makeClients([
      "results_drop_dave",
      "results_drop_erin",
      "results_drop_frank",
    ]);
    const room = await setUpRoom([dave, erin, frank], 3);
    await playOpeningRound([dave, erin, frank]);

    const erinTeardowns = collect(erin, "game:player_left");
    const frankTeardowns = collect(frank, "game:player_left");
    const graceNotices = collect(erin, "game:player_disconnected");

    const takeover = waitFor<{ userId: string }>(
      erin.socket,
      "game:seat_bot_takeover",
      5_000
    );
    dave.socket.disconnect();

    await new Promise((resolve) => setTimeout(resolve, LOBBY_GRACE_MS / 2));
    assert.ok(
      Object.values(seatedUsers(room.roomId) ?? {}).includes(dave.user.id),
      "the seat must still be theirs halfway through the grace"
    );

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

  /**
   * #850 clause 7 (docs/GAME-RULES.md § Decisions) made the seat a takeover left behind
   * reclaimable by the same account for the life of the match — `SEAT_RELEASED`
   * now answers only for a finished or disposed table, not a live one. Was
   * pinned the other way (nina refused with `SEAT_RELEASED`) before that
   * decision; re-pinned to prove the reclaim, alongside the one refusal that
   * is unchanged — an account that never sat here at all.
   */
  test("a seat given up while away is reclaimed by the account that left it; a stranger is still refused", async () => {
    const [nina, otto, pia, quinn] = await makeClients([
      "expired_nina",
      "expired_otto",
      "expired_pia",
      "expired_quinn",
    ]);
    const room = await setUpRoom([nina, otto, pia], 3);
    await playOpeningRound([nina, otto, pia]);

    const takeover = waitFor(otto.socket, "game:seat_bot_takeover", 5_000);
    nina.socket.disconnect();
    await takeover;

    const back = await reconnectAs(server, nina);
    const reclaimed = waitFor<{ userId?: string }>(
      otto.socket,
      "game:player_reconnected",
      5_000
    );
    back.emit("game:rejoin", { roomId: room.roomId });
    assert.equal((await reclaimed).userId, nina.user.id);

    // Quinn registered but never joined: the same live table, still refused.
    const stranger = waitFor<Record<string, unknown>>(quinn.socket, "game:rejoin_failed", 5_000);
    quinn.socket.emit("game:rejoin", { roomId: room.roomId });
    assert.deepEqual(
      await stranger,
      { ...payload("UNAUTHORIZED"), roomId: room.roomId },
      "an account that never sat here is still refused, not explained to, in the { code, message } a client renders and with the roomId its stale-reply guard matches"
    );

    back.close();
  });

  // ── Test 9 ──────────────────────────────────────────────────────────────

  test("the last player leaving the results screen disposes the room", async () => {
    const [gina, hugo] = await makeClients([
      "results_dispose_gina",
      "results_dispose_hugo",
    ]);
    const room = await setUpRoom([gina, hugo], 2);
    await playOpeningRound([gina, hugo]);

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
    assert.ok(before.openingCard && !held.has(before.openingCard.id));

    idle.socket.emit("game:play", { cardIds: [before.openingCard.id], seq: intentSeq(before) });

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
    assert.ok(before.openingCard && held.has(before.openingCard.id));

    // The play is *refused*, not narrowed to the cards the sender does hold.
    // `player.hand.filter(...)` would otherwise turn a forged two-card play
    // into a legal single and let it through as if it had been asked for.
    const rejected = waitFor<{ code: string }>(onTurn.socket, "game:error");
    onTurn.socket.emit("game:play", { cardIds: [before.openingCard.id, foreign.id], seq: intentSeq(before) });
    assert.equal((await rejected).code, "INVALID_CARD");

    const after = await authoritativeState(onTurn, room.roomId);
    assert.equal(after.currentTurnIndex, before.currentTurnIndex);
    assert.notEqual(after.openingCard, null);
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
    assert.notEqual(before.openingCard, null);
    assert.ok(before.openingCard, "the opening deal must name a start card");

    const other = before.players[before.viewerSeatIndex].hand.find(
      (c) => c.id !== before.openingCard!.id
    );
    assert.ok(other, "the seat on turn holds more than the start card");

    const rejected = waitFor<ServerPayload>(onTurn.socket, "game:error");
    onTurn.socket.emit("game:play", { cardIds: [other.id], seq: intentSeq(before) });
    const told = await rejected;
    assert.equal(told.code, "INVALID_MOVE");
    assert.equal(told.params?.refusal, "needsStartCard");

    const after = await authoritativeState(onTurn, room.roomId);
    assert.notEqual(after.openingCard, null);
    assert.deepEqual(
      after.players.map((p) => p.handCount),
      before.players.map((p) => p.handCount)
    );
  });

  test("only the host starts a room or its next match, never alone, and visibility is fixed once dealt", async () => {
    const [host, guest] = await makeClients(["start_refusal_host", "start_refusal_guest"]);
    const created = waitFor<RoomState>(host.socket, "room:state");
    host.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
    const { code } = await created;
    assert.equal((await refusal(host, "room:start")).code, "MIN_PLAYERS_REQUIRED");

    const joined = waitFor<RoomState>(guest.socket, "room:state");
    guest.socket.emit("room:join", { code });
    await joined;
    assert.equal((await refusal(guest, "room:start")).code, "NOT_THE_HOST");

    const single = await driveRoundToExchangeOrOver([host, guest], () => {
      host.socket.emit("room:start", { matchLength: "single" });
    });
    assert.equal(single.stoppedOn, "roundOver");
    // After a match, the guest's start would count as a vote before `closeForStart` checks the host.
    assert.equal((await refusal(guest, "room:start")).code, "NOT_THE_HOST");

    const late = await refusal(host, "room:setVisibility", { visibility: "public" });
    assert.equal(late.code, "GAME_ALREADY_STARTED");
  });

  test("moves the table cannot take are refused by code, and the table stays put", async () => {
    const [alice, bob] = await makeClients(["refusal_alice", "refusal_bob"]);
    const room = await setUpRoom([alice, bob], 2);
    const states = await startGame([alice, bob]);
    const leadIdx = states.findIndex((s) => s.viewerSeatIndex === s.currentTurnIndex);
    const lead = [alice, bob][leadIdx]!;
    const other = [alice, bob][1 - leadIdx]!;
    const before = states[leadIdx]!;
    const hand = before.players[before.viewerSeatIndex].hand;
    const start = before.openingCard!;
    const offRank = hand.find((c) => !c.isJoker && c.rank !== start.rank);
    assert.ok(offRank, "a fourteen-card hand holds a second rank");

    const seq = intentSeq(before);
    assert.equal((await refusal(lead, "game:pass", { seq })).code, "CANNOT_PASS");
    const mixedTold = waitFor<ServerPayload>(lead.socket, "game:error");
    const mixed = await refusal(lead, "game:play", { cardIds: [start.id, offRank.id], seq });
    assert.equal(mixed.code, "INVALID_MOVE");
    assert.equal((await mixedTold).params?.refusal, "notACombination");
    const unowed = await refusal(lead, "game:exchange_give_card", { cardId: hand[0].id, seq });
    assert.equal(unowed.code, "NO_EXCHANGE");
    assert.equal((await refusal(lead, "room:spectate", { code: room.code })).code, "ALREADY_IN_ROOM");

    const unmoved = await authoritativeState(lead, room.roomId);
    assert.equal(unmoved.currentTurnIndex, before.currentTurnIndex);
    assert.notEqual(unmoved.openingCard, null);

    assert.equal((await refusal(lead, "game:play", { cardIds: [start.id], seq })).ok, true);
    const otherBefore = states[1 - leadIdx]!;
    const otherHand = otherBefore.players[otherBefore.viewerSeatIndex].hand;
    const wrongShape = getAllValidPlays(otherHand, { toBeat: null, mustInclude: null }).find(
      (p) => p.cards.length > 1 && p.type !== "bomb" && p.type !== "royal_straight"
    );
    assert.ok(wrongShape, "a fourteen-card hand holds a pair or a run");
    const unbeatenTold = waitFor<ServerPayload>(other.socket, "game:error");
    const unbeaten = await refusal(other, "game:play", { cardIds: wrongShape.cards.map((c) => c.id), seq: seq + 1 });
    assert.equal(unbeaten.code, "INVALID_MOVE");
    assert.equal((await unbeatenTold).params?.refusal, "wrongType");

    const after = await authoritativeState(other, room.roomId);
    assert.equal(after.currentTurnIndex, otherBefore.viewerSeatIndex);
    assert.equal(after.players[otherBefore.viewerSeatIndex].handCount, otherHand.length);

    // A restart that lost the game leaves exactly this: a room row mid-game, and nothing to deal into.
    disposeGame(server.rt, room.roomId);
    for (let tries = 0; ; tries++) {
      const rows = await db().select().from(activeGamesTable).where(eq(activeGamesTable.roomId, room.roomId));
      if (rows.length === 0) break;
      assert.ok(tries < 50, "the persisted game was never deleted");
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal((await refusal(alice, "room:start")).code, "ROOM_NOT_WAITING");
  });
});
