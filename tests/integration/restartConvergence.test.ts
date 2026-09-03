// tests/integration/restartConvergence.test.ts — the server is replaced under
// a live table and a live lobby, and nobody loses anything (#600, out of #544).
//
// #544 closed on the claim that a restart costs nobody their seat, their game
// or a message, and nothing ever proved it. `crossInstance.test.ts` kills one
// of two instances and proves the *other* takes the table over;
// `reconnect.test.ts` reconnects a client to a server that stayed up. Neither
// restarts the process under a table and then asks whether every client is
// whole afterwards, which is the one thing a deploy actually does.
//
// What it asserts, and why it is not a list of expected cards: `shuffleDeck`
// draws from `crypto`, so a seed pins nothing and every run deals differently.
// Each client's own state is captured before the kill and compared with its own
// state after — whatever you had, you still have. That is the stronger claim as
// well as the only available one: a restart that handed back a *valid* table
// which is not the one the client was holding would satisfy an expected-cards
// assertion and fail this one.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import pg from "pg";
import { io as ioClient, type Socket } from "socket.io-client";
import { hasDatabase, skipMessage } from "../helpers/testServer.ts";

const PORT = 5571;
/**
 * How long the table must say nothing before it counts as settled. The server
 * addresses each recipient separately, so two views captured mid-broadcast
 * disagree for a reason that is not a defect.
 */
const QUIET_MS = 900;
const SETTLE_CEILING_MS = 20_000;

interface Client {
  name: string;
  cookie: string;
  socket: Socket;
  /** The last state this client was sent, whatever it was addressed about. */
  game: Record<string, unknown> | null;
  room: Record<string, unknown> | null;
  /** Bumped by every inbound state, so quiescence is observable. */
  heard: number;
}

function boot(databaseUrl: string): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "server/index.ts"], {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        PORT: String(PORT),
        SESSION_SECRET: "restart-convergence-secret",
        LOG_LEVEL: "silent",
        NODE_ENV: "development",
        // Nothing here plays a hand, and an AFK auto-move between the two
        // captures would be a table that changed for a reason that is not the
        // restart.
        MURLAN_AFK_TIMEOUT_MS: "600000",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const giveUp = setTimeout(() => reject(new Error("the server never came up")), 45_000);
    const watch = (buf: unknown) => {
      const line = String(buf);
      if (line.includes(String(PORT)) || line.includes("listening")) {
        clearTimeout(giveUp);
        setTimeout(() => resolve(child), 600);
      }
    };
    child.stdout?.on("data", watch);
    child.stderr?.on("data", watch);
  });
}

async function register(username: string): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "restart-convergence-pw", email: `${username}@example.test` }),
  });
  const text = await res.text();
  assert.equal(res.status, 200, `register ${username}: ${text}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

/** A socket that does not reconnect itself: the restart is what this measures. */
function connect(cookie: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(`http://127.0.0.1:${PORT}`, {
      transports: ["websocket"],
      extraHeaders: { Cookie: cookie },
      reconnection: false,
    });
    s.once("connect", () => resolve(s));
    s.once("connect_error", reject);
  });
}

function listen(client: Client): void {
  client.socket.on("game:state", (state: Record<string, unknown>) => {
    client.game = state;
    client.heard += 1;
  });
  client.socket.on("room:state", (state: Record<string, unknown>) => {
    client.room = state;
    client.heard += 1;
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function waitFor<T>(socket: Socket, event: string, ms = 10_000): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Waits until the row a replacement instance would rehydrate the table from exists. */
async function persisted(databaseUrl: string, roomId: string): Promise<void> {
  const admin = new pg.Pool({ connectionString: databaseUrl });
  try {
    const deadline = Date.now() + SETTLE_CEILING_MS;
    for (;;) {
      const { rowCount } = await admin.query("SELECT 1 FROM active_games WHERE room_id = $1", [
        roomId,
      ]);
      if (rowCount) return;
      assert.ok(Date.now() < deadline, "the deal was never persisted, so no restart could find it");
      await sleep(200);
    }
  } finally {
    await admin.end();
  }
}

/** Waits until nobody has been told anything for `QUIET_MS`. */
async function settled(clients: Client[]): Promise<void> {
  const deadline = Date.now() + SETTLE_CEILING_MS;
  for (;;) {
    const before = clients.reduce((n, c) => n + c.heard, 0);
    await sleep(QUIET_MS);
    const after = clients.reduce((n, c) => n + c.heard, 0);
    if (before === after) return;
    assert.ok(Date.now() < deadline, "the table never went quiet, so nothing could be compared");
  }
}

/**
 * The part of a client's own view that a restart must not change. Deliberately
 * derived rather than listed: a field added to the wire tomorrow is compared
 * the day it lands, and only the fields that legitimately move — a countdown,
 * a deadline — are named to be dropped.
 */
const MOVES_ON_ITS_OWN = new Set(["turnDeadlineMs", "turnSecondsRemaining"]);

function held(state: Record<string, unknown> | null): unknown {
  if (state === null) return null;
  const kept = Object.fromEntries(
    Object.entries(state).filter(([key]) => !MOVES_ON_ITS_OWN.has(key))
  );
  return JSON.parse(JSON.stringify(kept));
}

describe(
  "a server replaced under a live table",
  { skip: hasDatabase() ? false : skipMessage() },
  () => {
    const schema = `restart_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const baseUrl = process.env.DATABASE_URL!;
    const scoped = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}options=-c%20search_path%3D${schema}`;
    const clients: Client[] = [];
    let server: ChildProcess;
    /** The table with a hand in progress, and the lobby nobody has started. */
    let table = { roomId: "", code: "" };
    let lobby = { roomId: "", code: "" };

    before(async () => {
      const admin = new pg.Pool({ connectionString: baseUrl });
      await admin.query(`CREATE SCHEMA "${schema}"`);
      await admin.end();

      server = await boot(scoped);

      const tag = Date.now().toString(36);
      for (const who of ["t1", "t2", "l1", "l2", "l3"]) {
        const name = `rc${who}${tag}`;
        const cookie = await register(name);
        const socket = await connect(cookie);
        const client: Client = { name, cookie, socket, game: null, room: null, heard: 0 };
        listen(client);
        clients.push(client);
      }
    });

    after(async () => {
      for (const c of clients) c.socket.close();
      server?.kill("SIGKILL");
      const admin = new pg.Pool({ connectionString: baseUrl });
      try {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await admin.end();
      }
    });

    test("a hand in progress and a lobby both survive the process that held them", async () => {
      const [t1, t2, l1, l2, l3] = clients;

      // A table with a hand actually dealt.
      const madeTable = waitFor<{ code: string; roomId: string }>(t1.socket, "room:state");
      t1.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
      const created = await madeTable;
      assert.ok(created, "the table was never created");
      table = { roomId: created.roomId, code: created.code };

      const seated = waitFor(t1.socket, "room:state");
      t2.socket.emit("room:join", { code: table.code });
      assert.ok(await seated, "the second player's join never reached the host");

      const dealt = waitFor(t2.socket, "game:state", 20_000);
      t1.socket.emit("room:start");
      assert.ok(await dealt, "the hand was never dealt");

      // A lobby that has not started: three seated, nothing else.
      const madeLobby = waitFor<{ code: string; roomId: string }>(l1.socket, "room:state");
      l1.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 4 });
      const opened = await madeLobby;
      assert.ok(opened, "the lobby was never created");
      lobby = { roomId: opened.roomId, code: opened.code };
      for (const joiner of [l2, l3]) {
        const heard = waitFor(l1.socket, "room:state");
        joiner.socket.emit("room:join", { code: lobby.code });
        assert.ok(await heard, "a lobby join never reached the host");
      }

      await settled(clients);
      // Quiet sockets are not a persisted table. `persistGameState` is
      // fire-and-forget beside `broadcastGameState`, so a client can be holding
      // a hand the `active_games` row does not carry yet — and the replacement
      // rehydrates from that row alone. Killing before it lands fails this test
      // for a race in the test rather than anything about a restart.
      await persisted(scoped, table.roomId);
      const before = clients.map((c) => ({ game: held(c.game), room: held(c.room) }));
      assert.ok(
        before[0].game !== null && before[1].game !== null,
        "neither seat at the table was holding a hand, so the restart has nothing to lose"
      );
      assert.ok(
        before[2].room !== null,
        "the lobby was never delivered, so the restart has nothing to lose"
      );

      // The deploy: the process that owns both rooms is replaced by one that
      // has never seen either of them.
      server.kill("SIGKILL");
      for (const c of clients) c.socket.close();
      // Long enough for the kernel to release the listening socket, which is
      // all this waits on: the room's advisory lock is session-scoped and
      // Postgres drops it when the killed backend dies.
      await sleep(1_000);
      server = await boot(scoped);

      // Every client comes back the way the real one does — a fresh socket,
      // then the rejoin it emits on connect (context/SocketContext.tsx).
      for (const c of clients) {
        c.socket = await connect(c.cookie);
        c.heard = 0;
        c.game = null;
        c.room = null;
        listen(c);
      }
      for (const c of [t1, t2]) c.socket.emit("game:rejoin", { roomId: table.roomId });
      for (const c of [l1, l2, l3]) c.socket.emit("room:rejoin", { code: lobby.code });

      const refused = await Promise.all(
        [t1, t2].map((c) => waitFor<{ roomId: string }>(c.socket, "game:rejoin_failed", 2_000))
      );
      assert.deepEqual(
        refused.filter(Boolean),
        [],
        "a seat was refused its own table after the restart"
      );

      await settled(clients);
      const after = clients.map((c) => ({ game: held(c.game), room: held(c.room) }));

      for (const [i, c] of clients.entries()) {
        assert.deepEqual(
          after[i].game,
          before[i].game,
          `${c.name} came back to a different game than it was holding`
        );
        assert.deepEqual(
          after[i].room,
          before[i].room,
          `${c.name} came back to a different room than it was holding`
        );
      }
    });
  }
);
