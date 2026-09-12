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

function boot(databaseUrl: string, extraEnv: Record<string, string> = {}): Promise<ChildProcess> {
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
        ...extraEnv,
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
  assert.equal(res.status, 202, `register ${username}: ${text}`);
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

interface StoredRow {
  /** The envelope's `seats` block — the vacate bookkeeping a restore reads. */
  seats: Record<string, unknown>;
  updatedAt: number;
}

/**
 * The `active_games` row a replacement instance rehydrates the table from, once
 * `ready` accepts it. Polled rather than read once: `persistGameState` is
 * fire-and-forget beside the broadcast, so the row lags the wire the table was
 * observed on.
 */
async function storedRow(
  databaseUrl: string,
  roomId: string,
  ready: (row: StoredRow) => boolean,
  what: string
): Promise<StoredRow> {
  const admin = new pg.Pool({ connectionString: databaseUrl });
  try {
    const deadline = Date.now() + SETTLE_CEILING_MS;
    for (;;) {
      const { rows } = await admin.query<{
        game_state: { seats?: Record<string, unknown> };
        updated_at: Date;
      }>("SELECT game_state, updated_at FROM active_games WHERE room_id = $1", [roomId]);
      const stored = rows[0];
      if (stored) {
        const row = { seats: stored.game_state?.seats ?? {}, updatedAt: stored.updated_at.getTime() };
        if (ready(row)) return row;
      }
      assert.ok(Date.now() < deadline, what);
      await sleep(200);
    }
  } finally {
    await admin.end();
  }
}

/**
 * The deploy: the process that owns the room is replaced by one that has never
 * seen it. Every caller closes its sockets *after* the kill, so no disconnect
 * grace runs on a server that is still up to arm one.
 *
 * The sleep is the kernel releasing the listening socket, which is all this
 * waits on: the room's advisory lock is session-scoped, and Postgres drops it
 * when the killed backend dies.
 */
async function replaceServer(
  dying: ChildProcess,
  clients: Client[],
  databaseUrl: string,
  extraEnv: Record<string, string> = {}
): Promise<ChildProcess> {
  dying.kill("SIGKILL");
  for (const c of clients) c.socket.close();
  await sleep(1_000);
  return boot(databaseUrl, extraEnv);
}

/**
 * Whether a client's own view says that seat is a vacated one — all a
 * `game:state` says about `vacatedSeats`, written by `sanitizeStateForPlayer`.
 * `undefined` when that client has been sent no state yet.
 */
function vacatedAt(client: Client, seat: number): boolean | undefined {
  return (client.game?.players as { vacated?: boolean }[] | undefined)?.[seat]?.vacated;
}

/** Waits for something the server says only through a state it broadcasts. */
async function until(what: string, ready: () => boolean): Promise<void> {
  const deadline = Date.now() + SETTLE_CEILING_MS;
  while (!ready()) {
    assert.ok(Date.now() < deadline, what);
    await sleep(100);
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
      await storedRow(
        scoped,
        table.roomId,
        () => true,
        "the deal was never persisted, so no restart could find it"
      );
      const before = clients.map((c) => ({ game: held(c.game), room: held(c.room) }));
      assert.ok(
        before[0].game !== null && before[1].game !== null,
        "neither seat at the table was holding a hand, so the restart has nothing to lose"
      );
      assert.ok(
        before[2].room !== null,
        "the lobby was never delivered, so the restart has nothing to lose"
      );

      server = await replaceServer(server, clients, scoped);

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

/**
 * The table above has nobody leave it, so it says nothing about the four
 * collections `vacateSeat` writes — the reclaim, the end-match vote, the
 * forfeit and the weak takeover all hang off those, and the row is the only
 * thing a replacement instance can read them from (#958, docs/BRIEF.md §3.1).
 */
describe(
  "a seat vacated before the server was replaced",
  { skip: hasDatabase() ? false : skipMessage() },
  () => {
    const schema = `restart_vacated_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const baseUrl = process.env.DATABASE_URL!;
    const scoped = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}options=-c%20search_path%3D${schema}`;
    /** The wait between the leaver's socket closing and its seat being vacated. */
    const GRACE_MS = 1_200;
    const clients: Client[] = [];
    let server: ChildProcess;
    let table = { roomId: "", code: "" };

    before(async () => {
      const admin = new pg.Pool({ connectionString: baseUrl });
      await admin.query(`CREATE SCHEMA "${schema}"`);
      await admin.end();

      // Both blocks boot on PORT, and the block above kills its own server in
      // an `after` that does not wait for the kernel to release the socket.
      await sleep(1_000);
      server = await boot(scoped, { MURLAN_DISCONNECT_GRACE_MS: String(GRACE_MS) });

      const tag = Date.now().toString(36);
      for (const who of ["a", "b", "c"]) {
        const name = `rv${who}${tag}`;
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

    test("the reclaim, the end-match vote and the forfeit all survive the restart", async () => {
      const [a, b, c] = clients;

      // Three seats, not two: a vacate that leaves one human disposes the
      // table outright (`vacateSeat`), and there would be nothing to restore.
      const madeTable = waitFor<{ code: string; roomId: string }>(a.socket, "room:state");
      a.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 3 });
      const created = await madeTable;
      assert.ok(created, "the table was never created");
      table = { roomId: created.roomId, code: created.code };

      for (const joiner of [b, c]) {
        const heard = waitFor(a.socket, "room:state");
        joiner.socket.emit("room:join", { code: table.code });
        assert.ok(await heard, "a join never reached the host");
      }

      const dealt = waitFor(c.socket, "game:state", 20_000);
      a.socket.emit("room:start");
      assert.ok(await dealt, "the hand was never dealt");
      const cSeat = c.game?.viewerSeatIndex as number;
      assert.ok(Number.isInteger(cSeat), "the third seat never learned which seat it was");

      // Mid-hand, so the walkout is a forfeit and the takeover is held weak:
      // nobody has played, so no seat can have finished its hand.
      c.socket.close();
      await until(
        "the grace expired without the seat being vacated",
        () => vacatedAt(a, cSeat) === true
      );
      const beforeKill = await storedRow(
        scoped,
        table.roomId,
        ({ seats }) => (seats.vacatedSeats as unknown[] | undefined)?.length === 1,
        "the vacate was never persisted, so no restart could find it"
      );
      const leaver = (beforeKill.seats.releasedSeats as string[])[0];
      assert.deepEqual(beforeKill.seats, {
        vacatedSeats: [[cSeat, { userId: leaver, username: c.name }]],
        releasedSeats: [leaver],
        weakSeats: [cSeat],
        abandonedSeats: [[cSeat, leaver]],
      });

      server = await replaceServer(server, [a, b], scoped, {
        MURLAN_DISCONNECT_GRACE_MS: String(GRACE_MS),
      });

      for (const client of [a, b]) {
        client.socket = await connect(client.cookie);
        client.game = null;
        listen(client);
        client.socket.emit("game:rejoin", { roomId: table.roomId });
      }
      await until(
        "the replacement instance restored the table without the vacated seat",
        () => [a, b].every((client) => vacatedAt(client, cSeat) === true)
      );

      // One vote of the two seats a human still holds, so the tally comes back
      // and the match stays live. `endMatchVoteAction` refuses with
      // NO_VACANCY_TO_END before it tallies anything when `vacatedSeats` is
      // empty, so a tally arriving at all is the restored map being read.
      const tally = waitFor<{ votes: string[] }>(a.socket, "game:end_match_vote_state");
      a.socket.emit("game:end_match_vote", { wants: true });
      assert.equal(
        (await tally)?.votes.length,
        1,
        "the seats still at the table were refused the vote a vacancy opens"
      );

      // Replaced a second time, and this time the leaver is the first back: the
      // table is in no instance's memory, so its own `game:rejoin` is what pulls
      // it over. `rehydrateGame`'s gate reads the roster, which no longer holds
      // them, and the row's vacated seats are the only thing that still does.
      server = await replaceServer(server, [a, b], scoped, {
        MURLAN_DISCONNECT_GRACE_MS: String(GRACE_MS),
      });

      // Asserted on the seat coming back rather than on no `game:rejoin_failed`
      // arriving: a refusal is silence within a window, and so is a slow runner.
      // The state c held before the kill satisfies both halves, so clearing it
      // is what makes this about the reclaim.
      c.socket = await connect(c.cookie);
      c.game = null;
      listen(c);
      c.socket.emit("game:rejoin", { roomId: table.roomId });
      await until(
        "the seat never came back to the account that left it",
        () => c.game?.viewerSeatIndex === cSeat && vacatedAt(c, cSeat) === false
      );

      // The reclaim persists, so this row is the restored table's own write —
      // which is what makes the two collections a reclaim does not clear a claim
      // about what crossed two restarts rather than about the row they were read
      // from. `weakSeats` is inert on a seat a human holds again; it is asserted
      // because losing it is the defect, not because the seat is still weak.
      const afterReclaim = await storedRow(
        scoped,
        table.roomId,
        ({ updatedAt }) => updatedAt > beforeKill.updatedAt,
        "the reclaim never wrote the row back, so nothing here is about the restore"
      );
      assert.deepEqual(afterReclaim.seats, {
        vacatedSeats: [],
        releasedSeats: [],
        weakSeats: [cSeat],
        abandonedSeats: [[cSeat, leaver]],
      });
    });
  }
);
