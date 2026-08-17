import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { io as ioClient, type Socket } from "socket.io-client";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { connectAs, waitFor } from "../helpers/client.ts";
import {
  setUpRoom,
  startGame,
  type Client,
  type SanitizedState,
} from "../helpers/table.ts";

/**
 * The reconnect paths: what the table is told when a dropped player comes
 * back, and what the turn scheduler does about it.
 *
 * `server/socket.ts` reads these once at module scope, so they must be set
 * before that module is first imported — this file always runs as its own
 * process under `node --test`, so the override never leaks into another test
 * file's process. The grace window has to outlast a real HTTP round-trip for
 * the ticket plus a websocket handshake, since a returning player is a whole
 * new socket here.
 */
process.env.MURLAN_AFK_TIMEOUT_MS = "400";
process.env.MURLAN_DISCONNECT_GRACE_MS = "4000";
process.env.MURLAN_BOT_MOVE_DELAY_MS = "20";

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
  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
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
      back.emit("game:rejoin", { roomCode: room.roomId });
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
      client.socket.emit("game:rejoin", { roomCode: roomId });
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
        where: eq(activeGames.roomCode, roomId),
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
    const { __testables } = await import("../../server/socket.ts");
    const erin = await connectAs(server, "rehydrate_erin");
    const frank = await connectAs(server, "rehydrate_frank");
    const room = await setUpRoom([erin, frank], 2);
    const table = [erin, frank];
    try {
      await startGame(table);
      // The write that outlives a restart is fire-and-forget, so the row is
      // not there yet when the opening deal reaches the clients.
      await waitForPersistedGame(room.roomId);

      // What a restart leaves behind: the row, and nothing in memory.
      assert.equal(__testables.forgetActiveGame(room.roomId), true);
      assert.equal(__testables.hasActiveGame(room.roomId), false);

      const passes = collectAfkPasses(frank.socket);
      const restored = waitFor<SanitizedState>(erin.socket, "game:state", 5_000);
      const refused = new Promise<never>((_, reject) => {
        erin.socket.once("game:rejoin_failed", (payload: unknown) =>
          reject(new Error(`game:rejoin_failed ${JSON.stringify(payload)}`))
        );
      });
      erin.socket.emit("game:rejoin", { roomCode: room.roomId });
      const state = await Promise.race([restored, refused]);
      assert.equal(__testables.hasActiveGame(room.roomId), true);

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

  // ── Test 5 ──────────────────────────────────────────────────────────────

  /**
   * The client's stale-reply guard compares `roomCode` against the room it
   * asked about, so a reply that renamed, normalised or omitted it would make
   * every failure look like it answers somebody else's attempt.
   */
  test("a rejoin failure echoes the requested roomCode verbatim", async () => {
    const gina = await connectAs(server, "echo_gina");
    try {
      const failed = waitFor<{ roomCode?: string; code?: string }>(
        gina.socket,
        "game:rejoin_failed",
        5_000
      );
      const asked = "00000000-0000-4000-8000-00000000dead";
      gina.socket.emit("game:rejoin", { roomCode: asked });
      const payload = await failed;
      assert.equal(payload.roomCode, asked);
      assert.equal(payload.code, "GAME_NOT_FOUND");
    } finally {
      gina.socket.close();
    }
  });
});
