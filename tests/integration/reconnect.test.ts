import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { io as ioClient, type Socket } from "socket.io-client";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { MATCH_TARGETS, targetsFor } from "../../lib/gameEngine.ts";
import { lobbyGraceMs } from "../../server/gameTimers.ts";
import { connectAs, waitFor } from "../helpers/client.ts";
import {
  driveHandToExchangeOrOver,
  gameOverOf,
  setUpRoom,
  startGame,
  waitForDeal,
  type Client,
  type RoomState,
  type SanitizedState,
} from "../helpers/table.ts";

/**
 * The reconnect paths: what the table is told when a dropped player comes
 * back, and what the turn scheduler does about it.
 *
 * `node --test` gives this file its own process, so the override never leaks
 * into another test file. The grace window has to outlast a real HTTP round-trip for
 * the ticket plus a websocket handshake, since a returning player is a whole
 * new socket here.
 */
process.env.MURLAN_AFK_TIMEOUT_MS = "400";
process.env.MURLAN_DISCONNECT_GRACE_MS = "4000";

interface AuthedClient extends Client {
  cookie: string;
}

interface ReconnectNotice {
  userId: string;
  username: string;
  code?: string;
  message?: string;
  params?: { username?: string };
}

describe("reconnect", { skip: hasDatabase() ? false : skipMessage() }, () => {
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

  /**
   * A second socket for an account that already registered — the returning
   * half of a drop. `connectAs` would register a new user, and the register
   * route is rate limited per process, so the cookie is reused for a fresh
   * ticket instead.
   */
  async function reconnect(client: AuthedClient): Promise<Socket> {
    const res = await fetch(`${server.url}/api/auth/socket-ticket`, {
      method: "POST",
      headers: { cookie: client.cookie },
    });
    const text = await res.text();
    assert.equal(res.status, 200, text);
    const { ticket } = JSON.parse(text) as { ticket: string };

    const socket = ioClient(server.url, {
      auth: { ticket },
      transports: ["websocket"],
      reconnection: false,
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", (e) => reject(e));
    });
    return socket;
  }

  /**
   * Empties the table before its sockets go. A socket that simply closes on a
   * live game arms a disconnect grace timer, and this suite's grace outlasts
   * the whole file — the timer would then fire against a stopped server.
   */
  async function closeTable(clients: { socket: Socket }[]) {
    for (const client of clients) {
      if (client.socket.connected) client.socket.emit("room:leave");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    for (const client of clients) client.socket.close();
  }

  // ── Test 1 ──────────────────────────────────────────────────────────────

  /**
   * The connection handler's grace-timer block used to emit its own bare
   * `{ userId, username }`, which the client runs through
   * `translateServerPayload`: with no `code` and no `message` that resolves to
   * "an unexpected error occurred" and the whole table is shown an error
   * banner on the most ordinary reconnect there is. Both reconnect paths now
   * go through one emitter, so the payload is asserted on the path that had
   * the wrong one — and then again after an explicit `game:rejoin`, which is
   * what the app itself emits on connect.
   */
  test("a reconnect inside the grace window is announced as PLAYER_RECONNECTED", async () => {
    const alice = await connectAs(server, "recon_notice_alice");
    const bob = await connectAs(server, "recon_notice_bob");
    const room = await setUpRoom([alice, bob], 2);
    await startGame([alice, bob]);

    const table = [alice, bob];
    const notices: ReconnectNotice[] = [];
    alice.socket.on("game:player_reconnected", (p: ReconnectNotice) =>
      notices.push(p)
    );

    const dropped = waitFor(alice.socket, "game:player_disconnected", 5_000);
    bob.socket.disconnect();
    await dropped;

    const announced = waitFor<ReconnectNotice>(
      alice.socket,
      "game:player_reconnected",
      5_000
    );
    // No game:rejoin: this is the connection handler's own grace-timer path,
    // reached by the socket coming back and nothing else.
    const back = await reconnect(bob);
    table[1] = { ...bob, socket: back };
    try {
      const notice = await announced;
      assert.equal(notice.userId, bob.user.id);
      assert.equal(notice.code, "PLAYER_RECONNECTED");
      assert.equal(notice.params?.username, bob.user.username);
      assert.ok(notice.message, "the payload must carry a fallback message");

      // The other path, from the same socket: the app fires game:rejoin from
      // its own connect handler.
      const rejoined = waitFor(alice.socket, "game:player_reconnected", 5_000);
      back.emit("game:rejoin", { roomId: room.roomId });
      await rejoined;

      assert.ok(notices.length >= 2, "both reconnect paths must announce the return");
      for (const seen of notices) {
        assert.equal(
          seen.code,
          "PLAYER_RECONNECTED",
          `every reconnect notice must be renderable: ${JSON.stringify(seen)}`
        );
      }
    } finally {
      await closeTable(table);
    }
  });

  // ── NET-04: a rejoin must not restart the acting seat's clock ───────────

  const AFK_MS = Number(process.env.MURLAN_AFK_TIMEOUT_MS);

  /**
   * The names of every seat the server has auto-passed for being idle, in
   * arrival order. The returned array is the live one the listener pushes
   * into — read it at assertion time, and attach it before the move that
   * could produce one.
   */
  function collectAfkPasses(socket: Socket): string[] {
    const seen: string[] = [];
    socket.on("game:notification", (payload: {
      code?: string;
      params?: { username?: string };
    }) => {
      if (payload?.code === "PLAYER_AFK_AUTO_PASS" && payload.params?.username) {
        seen.push(payload.params.username);
      }
    });
    return seen;
  }

  async function waitUntil(
    predicate: () => boolean,
    message: string,
    ms: number
  ): Promise<void> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail(message);
  }

  /** Re-emits `game:rejoin` several times per AFK window until stopped. */
  function rejoinOnALoop(client: Client, roomId: string): () => void {
    const handle = setInterval(() => {
      client.socket.emit("game:rejoin", { roomId });
    }, Math.round(AFK_MS / 3));
    return () => clearInterval(handle);
  }

  /** Waits for the `active_games` row the rehydration branch reads. */
  async function waitForPersistedGame(roomId: string): Promise<void> {
    const { db } = await import("../../server/db.ts");
    const { activeGames } = await import("../../shared/schema.ts");
    const { eq } = await import("drizzle-orm");
    for (let attempt = 0; attempt < 100; attempt++) {
      const row = await db.query.activeGames.findFirst({
        where: eq(activeGames.roomId, roomId),
      });
      if (row) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail("the live game was never written to active_games");
  }

  /** The client whose own seat has to act, from each client's opening state. */
  function clientOnTurn(clients: Client[], states: SanitizedState[]): Client {
    const index = states.findIndex(
      (state) => state.currentTurnIndex === state.viewerSeatIndex
    );
    assert.ok(index >= 0, "no client's opening state put them on turn");
    return clients[index];
  }

  // ── Test 2 ──────────────────────────────────────────────────────────────

  /**
   * `armTurn` clears the room's timers before arming a fresh full AFK window,
   * so a rejoin that re-armed unconditionally let a seated player park on
   * their own turn forever — `game:rejoin` is an ordinary client emit and 20
   * per minute is well inside the rate limit.
   */
  test("re-emitting game:rejoin does not hold the caller's own turn open", async () => {
    const alice = await connectAs(server, "afk_self_alice");
    const bob = await connectAs(server, "afk_self_bob");
    const room = await setUpRoom([alice, bob], 2);
    const table = [alice, bob];
    try {
      const states = await startGame(table);
      const actor = clientOnTurn(table, states);
      const observer = table.find((c) => c !== actor)!;

      const passes = collectAfkPasses(observer.socket);
      const stop = rejoinOnALoop(actor, room.roomId);
      try {
        await waitUntil(
          () => passes.includes(actor.user.username),
          "the looping player's seat was never auto-passed — every rejoin re-armed its AFK window",
          AFK_MS * 2.5
        );
      } finally {
        stop();
      }
    } finally {
      await closeTable(table);
    }
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────

  test("a rejoin by another seat does not extend the current player's deadline", async () => {
    const carol = await connectAs(server, "afk_other_carol");
    const dave = await connectAs(server, "afk_other_dave");
    const room = await setUpRoom([carol, dave], 2);
    const table = [carol, dave];
    try {
      const states = await startGame(table);
      const actor = clientOnTurn(table, states);
      const bystander = table.find((c) => c !== actor)!;

      const passes = collectAfkPasses(bystander.socket);
      const stop = rejoinOnALoop(bystander, room.roomId);
      try {
        await waitUntil(
          () => passes.includes(actor.user.username),
          "another seat's rejoins pushed the acting player's AFK deadline out",
          AFK_MS * 2.5
        );
      } finally {
        stop();
      }
    } finally {
      await closeTable(table);
    }
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────

  /**
   * The other half of NET-04: a game rehydrated from the database after a
   * restart carries no timers at all, so the rejoin that restores it is the
   * only thing that can start its clock. Over-tighten the re-arm guard and the
   * table comes back frozen.
   */
  test("a rejoin that rehydrates a game from the database arms its turn timer", async () => {
    const { hasActiveGame, forgetActiveGame } = await import("../helpers/liveGame.ts");
    const erin = await connectAs(server, "rehydrate_erin");
    const frank = await connectAs(server, "rehydrate_frank");
    const room = await setUpRoom([erin, frank], 2);
    const table = [erin, frank];
    try {
      await startGame(table);
      // Stop the room's clock before reading the row back. The read imports
      // the database module for the first time, which takes several AFK
      // windows at 400ms — long enough for the hand to auto-pass its way into
      // vacating a seat, and a vacated seat plays at BOT_MOVE_DELAY_MS. What
      // gets rehydrated below is then a hand that is already over, and the
      // table is disposed before the assertions can look at it.
      const { clearRoomTimers } = await import("../../server/gameTimers.ts");
      clearRoomTimers(room.roomId);
      // The write that outlives a restart is fire-and-forget, so the row is
      // not there yet when the opening deal reaches the clients.
      await waitForPersistedGame(room.roomId);

      // What a restart leaves behind: the row, and nothing in memory.
      assert.equal(forgetActiveGame(room.roomId), true);
      assert.equal(hasActiveGame(room.roomId), false);

      const passes = collectAfkPasses(frank.socket);
      const restored = waitFor<SanitizedState>(erin.socket, "game:state", 5_000);
      const refused = new Promise<never>((_, reject) => {
        erin.socket.once("game:rejoin_failed", (payload: unknown) =>
          reject(new Error(`game:rejoin_failed ${JSON.stringify(payload)}`))
        );
      });
      erin.socket.emit("game:rejoin", { roomId: room.roomId });
      const state = await Promise.race([restored, refused]);
      assert.equal(hasActiveGame(room.roomId), true);

      const onTurn = state.players[state.currentTurnIndex].name;
      await waitUntil(
        () => passes.includes(onTurn),
        "the rehydrated game came back with no armed timer — the table would sit there forever",
        AFK_MS * 4
      );
    } finally {
      await closeTable(table);
    }
  });

  // ── RES-03: a cosmetic DB failure must not forfeit a live seat ──────────

  /**
   * `emitRoomStateTo` re-sends the roster, which costs two DB reads the rejoin
   * itself does not depend on. The handler's blanket catch turns any throw
   * into `game:rejoin_failed SERVER_ERROR`, and the client used to answer that
   * by leaving the room — so one dropped connection during a reconnect handed
   * a live seat to a bot.
   */
  test("a failed roster read does not fail a rejoin that holds a seat", async () => {
    const { storage } = await import("../../server/storage.ts");
    const hank = await connectAs(server, "roster_hank");
    const ivy = await connectAs(server, "roster_ivy");
    const room = await setUpRoom([hank, ivy], 2);
    const table = [hank, ivy];
    const realGetRoomPlayers = storage.getRoomPlayers;
    try {
      await startGame(table);

      let tripped = 0;
      storage.getRoomPlayers = async function (roomId: string) {
        if (tripped === 0 && roomId === room.roomId) {
          tripped += 1;
          throw new Error("connection terminated unexpectedly");
        }
        return realGetRoomPlayers.call(this, roomId);
      };

      const restored = waitFor<SanitizedState>(hank.socket, "game:state", 5_000);
      const refused = new Promise<never>((_, reject) => {
        hank.socket.once("game:rejoin_failed", (payload: unknown) =>
          reject(new Error(`game:rejoin_failed ${JSON.stringify(payload)}`))
        );
      });
      hank.socket.emit("game:rejoin", { roomId: room.roomId });
      const state = await Promise.race([restored, refused]);

      assert.equal(tripped, 1, "the roster read never failed — the test proved nothing");
      // viewerSeatIndex is read straight out of the game's playerMap.
      assert.ok(
        state.viewerSeatIndex >= 0,
        "the rejoining player was not recognised at their own seat"
      );
    } finally {
      storage.getRoomPlayers = realGetRoomPlayers;
      await closeTable(table);
    }
  });

  test("a cold-start rejoin is given its room even when the roster read fails", async () => {
    const { storage } = await import("../../server/storage.ts");
    const jo = await connectAs(server, "cold_start_jo");
    const kai = await connectAs(server, "cold_start_kai");
    const room = await setUpRoom([jo, kai], 2);
    const table: { socket: Socket }[] = [jo, kai];
    const realGetRoomPlayers = storage.getRoomPlayers;
    let tripped = 0;
    try {
      await startGame([jo, kai]);

      const dropped = waitFor(jo.socket, "game:player_disconnected", 5_000);
      kai.socket.disconnect();
      await dropped;

      storage.getRoomPlayers = async function (roomId: string) {
        if (roomId === room.roomId) {
          tripped += 1;
          throw new Error("connection terminated unexpectedly");
        }
        return realGetRoomPlayers.call(this, roomId);
      };

      // A socket that has never been sent room:state: the app after a restart,
      // rejoining on the room id it read back from storage and nothing else.
      const back = await reconnect(kai);
      table[1] = { socket: back };
      const recovered = waitFor<RoomState>(back, "room:state", 5_000);
      const restored = waitFor<SanitizedState>(back, "game:state", 5_000);
      back.emit("game:rejoin", { roomId: room.roomId });
      const [roomState, state] = await Promise.all([recovered, restored]);

      assert.ok(tripped > 0, "the roster read never failed — the test proved nothing");
      assert.equal(roomState.roomId, room.roomId);
      assert.equal(roomState.code, room.code, "the join code must be the real one");
      assert.deepEqual(
        roomState.players.map((p) => p.userId).sort(),
        [jo.user.id, kai.user.id].sort(),
        "the recovered room must still seat both players"
      );
      assert.ok(
        state.viewerSeatIndex >= 0,
        "the rejoining player was not recognised at their own seat"
      );
    } finally {
      storage.getRoomPlayers = realGetRoomPlayers;
      await closeTable(table);
    }
  });

  // ── The match framing a rejoin arrives with ─────────────────────────────

  test("a rejoin is sent the running match target and scoreboard", async () => {
    const { matchSnapshot } = await import("../helpers/liveGame.ts");
    const alice = await connectAs(server, "framing_alice");
    const bob = await connectAs(server, "framing_bob");
    const room = await setUpRoom([alice, bob], 2);
    const table = [alice, bob];
    try {
      // A manche has to be banked first, or every score is zero and an empty
      // scoreboard would pass for the real one.
      gameOverOf(
        await driveHandToExchangeOrOver(
          table,
          () => alice.socket.emit("room:start"),
          { stopOnExchange: false }
        )
      );
      const dealt = waitForDeal(alice.socket);
      alice.socket.emit("game:rematch_vote");
      bob.socket.emit("game:rematch_vote");
      const manche = await dealt;

      const snapshot = matchSnapshot(room.roomId);
      assert.ok(snapshot, "the table must still be live");
      assert.equal(snapshot.matchTarget, targetsFor(2)[0]);
      assert.notEqual(
        snapshot.matchTarget,
        MATCH_TARGETS[0],
        "a two-seat target equal to the client's default would prove nothing"
      );
      const banked = Object.values(snapshot.cumulativeScores).reduce((a, b) => a + b, 0);
      assert.ok(banked > 0, "the first manche must have banked a point for somebody");

      const dropped = waitFor(alice.socket, "game:player_disconnected", 5_000);
      bob.socket.disconnect();
      await dropped;

      const back = await reconnect(bob);
      table[1] = { ...bob, socket: back };
      const framing = waitFor<{
        target: number;
        length: string;
        scores: Record<string, number>;
      }>(back, "game:match_state", 5_000);
      back.emit("game:rejoin", { roomId: room.roomId });
      const sent = await framing;

      assert.equal(sent.target, snapshot.matchTarget);
      assert.equal(sent.length, snapshot.matchLength);
      assert.deepEqual(
        Object.keys(sent.scores).sort(),
        manche.players.map((p) => p.name).sort(),
        "every seat must appear on the scoreboard the rejoining client is sent"
      );
      assert.equal(
        Object.values(sent.scores).reduce((a, b) => a + b, 0),
        banked,
        "the scoreboard must be the running one, not a fresh match's zeroes"
      );
    } finally {
      await closeTable(table);
    }
  });

  /**
   * The window between two manches — the hand is over, the next has not been
   * dealt — is the one where a drop used to cost the seat outright, with none
   * of the grace every other drop gets. The seat left `playerMap`, and from
   * then on every `game:rejoin` was answered `UNAUTHORIZED`: the account was
   * out of the match it was still playing, with no way back in.
   *
   * Found by the soak (#736), where a player dropped as a manche ended and
   * took no part in any of the ones that followed.
   */
  test("a blip between manches does not cost the player their seat", async () => {
    const { seatedUsers } = await import("../helpers/liveGame.ts");
    const alice = await connectAs(server, "between_alice");
    const bob = await connectAs(server, "between_bob");
    const room = await setUpRoom([alice, bob], 2);
    const table = [alice, bob];
    try {
      gameOverOf(
        await driveHandToExchangeOrOver(
          table,
          () => alice.socket.emit("room:start"),
          { stopOnExchange: false }
        )
      );
      assert.equal(
        seatedUsers(room.roomId)?.[1],
        bob.user.id,
        "the seat has to be held before the drop, or the assertion below is vacuous"
      );

      bob.socket.disconnect();
      // Nothing is broadcast on this path, so there is no event to await: the
      // release runs off the socket's own disconnect. Asked of the server
      // rather than restated, so a grace shorter than this reads as the seat
      // legitimately expiring instead of as the defect.
      await new Promise((resolve) => setTimeout(resolve, Math.min(500, lobbyGraceMs() / 2)));

      assert.equal(
        seatedUsers(room.roomId)?.[1],
        bob.user.id,
        "a drop between manches must hold the seat under the same grace as any other"
      );

      const back = await reconnect(bob);
      table[1] = { ...bob, socket: back };
      const answered = Promise.race([
        waitFor(back, "game:player_reconnected", 5_000).then(() => "rejoined" as const),
        waitFor<{ code?: string }>(back, "game:rejoin_failed", 5_000).then(
          (p) => `refused ${p.code}` as const
        ),
      ]);
      back.emit("game:rejoin", { roomId: room.roomId });
      assert.equal(await answered, "rejoined");
    } finally {
      await closeTable(table);
    }
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────

  /**
   * The client's stale-reply guard compares `roomId` against the room it
   * asked about, so a reply that renamed, normalised or omitted it would make
   * every failure look like it answers somebody else's attempt.
   */
  test("a rejoin failure echoes the requested roomId verbatim", async () => {
    const gina = await connectAs(server, "echo_gina");
    try {
      const failed = waitFor<{ roomId?: string; code?: string }>(
        gina.socket,
        "game:rejoin_failed",
        5_000
      );
      const asked = "00000000-0000-4000-8000-00000000dead";
      gina.socket.emit("game:rejoin", { roomId: asked });
      const payload = await failed;
      assert.equal(payload.roomId, asked);
      assert.equal(payload.code, "GAME_NOT_FOUND");
    } finally {
      gina.socket.close();
    }
  });

  // ── NET-03: a lobby reconnect has to recover the room too ───────────────

  /**
   * A drop with no live game frees the seat immediately, and there was no way
   * back: `game:rejoin` needs a game, so the returning socket held no
   * socketRoomMap entry and every room event it sent afterwards resolved to no
   * room and returned silently.
   */
  test("a guest that reconnects to a waiting lobby recovers the room", async () => {
    const alice = await connectAs(server, "lobby_back_alice");
    const bob = await connectAs(server, "lobby_back_bob");
    const room = await setUpRoom([alice, bob], 2);
    const table = [alice, bob];
    try {
      // The seat is held through the lobby grace, so the room never sees the
      // drop. What makes this a recovery is that the returning socket has no
      // socketRoomMap entry until it rejoins — without that, every later room
      // event resolves to no room and returns silently.
      bob.socket.disconnect();
      await new Promise((r) => setTimeout(r, 300));

      const back = await reconnect(bob);
      table[1] = { ...bob, socket: back };
      const recovered = waitFor<RoomState>(back, "room:state", 5_000);
      // The code the client already holds — no re-entry by the player.
      back.emit("room:rejoin", { code: room.code });
      const state = await recovered;

      assert.equal(state.roomId, room.roomId);
      assert.deepEqual(
        state.players.map((p) => p.userId).sort(),
        [alice.user.id, bob.user.id].sort()
      );
    } finally {
      await closeTable(table);
    }
  });

  /**
   * The host's half of the same drop. Releasing the seat also migrates the
   * host to the lowest remaining seat, so the returning player has to be back
   * at their own seat *and* holding the room again — otherwise `room:start` is
   * still the dead control the reconnect was supposed to fix.
   */
  test("a host that reconnects to a waiting lobby can still start the game", async () => {
    const carol = await connectAs(server, "lobby_host_carol");
    const dave = await connectAs(server, "lobby_host_dave");
    const room = await setUpRoom([carol, dave], 2);
    assert.equal(room.hostUserId, carol.user.id);
    const table = [carol, dave];
    try {
      // The room does not change hands over a dropped connection: the seat
      // row survives the grace, so carol is still the host throughout.
      carol.socket.disconnect();
      await new Promise((r) => setTimeout(r, 300));

      const back = await reconnect(carol);
      table[0] = { ...carol, socket: back };
      const recovered = waitFor<RoomState>(back, "room:state", 5_000);
      back.emit("room:rejoin", { code: room.code });
      assert.equal((await recovered).hostUserId, carol.user.id);

      const dealt = waitFor<SanitizedState>(dave.socket, "game:state", 5_000);
      back.emit("room:start");
      const state = await dealt;
      assert.equal(state.players.length, 2);
    } finally {
      await closeTable(table);
    }
  });

  /**
   * The rejection path: the seat is gone for good once the room is, and the
   * client answers a room:error by dropping the lobby it is showing.
   */
  test("a rejoin to a room that no longer waits is refused", async () => {
    const jack = await connectAs(server, "lobby_gone_jack");
    try {
      const refused = waitFor<{ code?: string }>(jack.socket, "room:error", 5_000);
      jack.socket.emit("room:rejoin", { code: "ZZZZZZ" });
      assert.equal((await refused).code, "ROOM_NOT_FOUND");
    } finally {
      jack.socket.close();
    }
  });

  /**
   * What `room:rejoin` will and will not do for the caller, on one table.
   *
   * The two cases share a lobby because `/api/auth/register` is rate limited
   * to 20 per process (see tests/helpers/table.ts) and this file is close to
   * that ceiling. They run in the order written: the refusal reads the table
   * the `before` builds, the re-seat then takes it apart.
   */
  describe("room:rejoin re-seats only the people who were in the room", () => {
    let kate: AuthedClient;
    let liam: AuthedClient;
    let mia: AuthedClient;
    let nate: AuthedClient;
    let room: RoomState;

    before(async () => {
      kate = await connectAs(server, "seat_back_kate");
      liam = await connectAs(server, "seat_back_liam");
      mia = await connectAs(server, "seat_back_mia");
      nate = await connectAs(server, "seat_back_nate");
      room = await setUpRoom([kate, liam, mia], 4);
    });

    after(async () => {
      await closeTable([kate, liam, mia, nate]);
    });

    /**
     * The six-character code is all it takes to reach a room, so the code
     * cannot also be what proves membership: `room:join` is the event for a
     * caller who was never seated, and it enforces the room's capacity and
     * status. A `room:rejoin` that seated them would additionally have handed
     * over the host role.
     */
    test("refuses a caller who was never in the room", async () => {
      const refused = waitFor<{ code?: string }>(nate.socket, "room:error", 5_000);
      nate.socket.emit("room:rejoin", { code: room.code });
      assert.equal((await refused).code, "NOT_IN_ROOM");
    });

    /**
     * Releasing a seat frees the lowest one as often as not, so "the returning
     * player is the lowest seat" is not the same question as "the returning
     * player was host". Only the account that lost the role gets it back.
     */
    test("re-seats a member who was not host without handing them the room", async () => {
      const migrated = waitFor<RoomState>(liam.socket, "room:state", 5_000);
      kate.socket.emit("room:leave");
      const afterLeave = await migrated;
      assert.equal(afterLeave.hostUserId, liam.user.id);
      assert.deepEqual(
        afterLeave.players.map((p) => p.userId).sort(),
        [liam.user.id, mia.user.id].sort()
      );

      mia.socket.disconnect();
      await new Promise((r) => setTimeout(r, 300));

      const back = await reconnect(mia);
      mia = { ...mia, socket: back };
      const recovered = waitFor<RoomState>(back, "room:state", 5_000);
      back.emit("room:rejoin", { code: room.code });
      const state = await recovered;

      // Mia never lost her seat, so she is back in the one she had rather
      // than sliding into the one kate vacated — and the room stayed liam's
      // throughout, which is what the old seat shuffle used to threaten.
      assert.ok(state.players.some((p) => p.userId === mia.user.id));
      assert.equal(state.hostUserId, liam.user.id);
    });
  });

  // ── RES-03: the room screen still draws when the `rooms` row is gone ─────

  /**
   * The client's only route into the game screen is `room` (non-null) ->
   * `/(online)/room` -> `gameState` (non-null) -> `/(online)/game`, so a
   * rejoin that cannot answer with `room:state` strands a player holding a
   * live hand. The roster half already fell back to the live game; the row
   * itself did not, because the six-character join code lived only in
   * `rooms.code` and inventing one would put an unjoinable code on screen.
   */
  test("a rejoin answers with room:state after the rooms row is deleted", async () => {
    const alice = await connectAs(server, "res03_alice");
    const bob = await connectAs(server, "res03_bob");
    const room = await setUpRoom([alice, bob], 2);
    await startGame([alice, bob]);

    try {
      await dbPool.query("DELETE FROM room_players WHERE room_id = $1", [room.roomId]);
      await dbPool.query("DELETE FROM rooms WHERE id = $1", [room.roomId]);

      const answered = waitFor<RoomState>(alice.socket, "room:state", 5_000);
      alice.socket.emit("game:rejoin", { roomId: room.roomId });
      const state = await answered;

      assert.equal(state.roomId, room.roomId);
      assert.equal(state.code, room.code, "the join code has to survive the row");
      assert.equal(state.hostUserId, alice.user.id);
      assert.deepEqual(
        state.players.map((p) => p.userId).sort(),
        [alice.user.id, bob.user.id].sort()
      );
    } finally {
      await closeTable([alice, bob]);
    }
  });
});
