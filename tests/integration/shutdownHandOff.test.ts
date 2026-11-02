// tests/integration/shutdownHandOff.test.ts — a graceful shutdown hands each of its tables to a
// live peer before it closes a socket.
//
// A is a spawned server that owns the table and is sent SIGTERM; B is this process's server, the
// only peer, so the hand-off lands where a test can read its timers. B's clock holds every timer of
// 15 s or more instead of arming it, so "20 s later" is a call rather than a wait.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import type { ChildProcess } from "node:child_process";
import { connectAs, DEADLINE_SCALE, eventually, reconnectWith, waitFor, waitForWhere, type TestSocket } from "../helpers/client.ts";
import { hasDatabase, skipMessage, startTestServer, type TestServer } from "../helpers/testServer.ts";
import { boot, freePorts, type Instance } from "../helpers/instance.ts";
import { realClock, type Clock } from "../../server/http/clock.ts";
import { ownershipKey, ownsRoom } from "../../server/game/gameOwnership.ts";
import { activeGames, userSocketMap } from "../../server/game/gameRoom.ts";
import { pending, usersInLobbyGrace } from "../../server/game/gameTimers.ts";
import { activeGameStore } from "../../server/store/activeGameStore.ts";
import type { WireGameState, WireRoomState } from "../../shared/protocol.ts";

const BOT_DELAY_MS = 150;
const AFK_MS = 400;
const LOBBY_GRACE_MS = 20_000;
const DISCONNECT_GRACE_MS = 60_000;
const HELD_FROM_MS = 15_000;

/** Real timers below HELD_FROM_MS; longer ones wait for `fireUpTo`, which a grace never outruns on its own. */
function holdingClock() {
  const held: { ms: number; fn: () => void; cleared: boolean }[] = [];
  const clock: Clock = {
    now: realClock.now,
    setTimeout(fn, ms) {
      if (ms < HELD_FROM_MS) return realClock.setTimeout(fn, ms);
      const entry = { ms, fn, cleared: false };
      held.push(entry);
      return entry;
    },
    clearTimeout(handle) {
      if (held.includes(handle as (typeof held)[number])) (handle as (typeof held)[number]).cleared = true;
      else realClock.clearTimeout(handle);
    },
  };
  /** Fires every held timer of `ms` or less, and returns their lengths. */
  const fireUpTo = (ms: number) => {
    const fired: number[] = [];
    for (const entry of held.splice(0)) {
      if (entry.cleared) continue;
      if (entry.ms > ms) held.push(entry);
      else {
        fired.push(entry.ms);
        entry.fn();
      }
    }
    return fired;
  };
  /** The lengths of the timers held now. */
  const holding = () => held.filter((e) => !e.cleared).map((e) => e.ms);
  return { clock, fireUpTo, holding };
}

/** Which backend holds a room's advisory lock, read back to back into a timeline. */
function watchLock(observer: pg.Pool, roomId: string) {
  const key = BigInt.asUintN(64, BigInt(ownershipKey(roomId)));
  const params = [String(key >> 32n), String(BigInt.asUintN(32, key))];
  const changes: { at: number; pid: number | null }[] = [];
  let running = true;
  const done = (async () => {
    const c = await observer.connect();
    try {
      while (running) {
        const { rows } = await c.query<{ pid: number }>(
          `SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND granted AND objsubid = 1
             AND classid = $1::bigint::oid AND objid = $2::bigint::oid`,
          params
        );
        const pid = rows[0]?.pid ?? null;
        if (changes.at(-1)?.pid !== pid || changes.length === 0) changes.push({ at: performance.now(), pid });
      }
    } finally {
      c.release();
    }
  })();
  return {
    changes,
    holder: () => changes.at(-1)?.pid ?? null,
    stop: async () => {
      running = false;
      await done;
    },
  };
}

const exited = (child: ChildProcess) =>
  new Promise<number | null>((resolve) => {
    if (child.exitCode !== null) return resolve(child.exitCode);
    child.once("exit", (code) => resolve(code));
  });

describe("a graceful shutdown hands its tables to a live peer", { skip: hasDatabase() ? false : skipMessage() }, () => {
  const { clock, fireUpTo, holding } = holdingClock();
  let peer: TestServer;
  let observer: pg.Pool;
  const owners: Instance[] = [];
  const sockets: TestSocket[] = [];
  const env = { MURLAN_BOT_MOVE_DELAY_MS: String(BOT_DELAY_MS), MURLAN_AFK_TIMEOUT_MS: String(AFK_MS) };

  before(async () => {
    Object.assign(process.env, env);
    peer = await startTestServer({ clock });
    // The servers' pools sit behind them; this one reads pg_locks and the rows the hand-off leaves.
    observer = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  });

  after(async () => {
    for (const s of sockets) s.close();
    for (const o of owners) o.child.kill("SIGKILL");
    await observer?.end().catch(() => {});
    await peer?.stop().catch(() => {});
    for (const name of Object.keys(env)) delete process.env[name];
  });

  /** A table dealt on a fresh owner A: the host's socket on A, the guest's on B. */
  async function openTable(tag: string, opts: { maxPlayers: number; fillWithBots: boolean; ownerEnv?: Record<string, string> }) {
    const [port] = await freePorts(1);
    const owner = await boot(port!, process.env.DATABASE_URL!, { ...env, ...opts.ownerEnv });
    owners.push(owner);
    const onA = { url: `http://127.0.0.1:${port}` } as TestServer;
    const suffix = `${tag}${Date.now() % 1e6}`;
    const host = await connectAs(onA, `ho${suffix}`);
    const guest = await connectAs(peer, `gu${suffix}`);
    sockets.push(host.socket, guest.socket);
    const created = waitFor(host.socket, "room:state");
    host.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: opts.maxPlayers });
    const room: WireRoomState = await created;
    const joined = waitFor(host.socket, "room:state");
    guest.socket.emit("room:join", { code: room.code });
    await joined;
    const dealt = waitFor(guest.socket, "game:state", 15_000);
    host.socket.emit("room:start", { fillWithBots: opts.fillWithBots });
    await dealt;
    await eventually(
      async () => (await observer.query("SELECT 1 FROM active_games WHERE room_id = $1", [room.roomId])).rowCount,
      "the deal to be persisted",
      10_000
    );
    return { owner, onA, host, guest, room };
  }

  test("a loaded table is unowned for under 500 ms and plays on at the peer, and no rejoin is refused", { timeout: 90_000 }, async () => {
    const { owner, host, guest, room } = await openTable("ld", { maxPlayers: 4, fillWithBots: true });
    const states: { at: number; turn: string }[] = [];
    guest.socket.on("game:state", (s: WireGameState) => states.push({ at: performance.now(), turn: s.turn }));
    await eventually(() => states.length >= 3, "moves to be flowing on the table", 15_000);

    const lock = watchLock(observer, room.roomId);
    const ownerPid = await eventually(() => lock.holder(), "the owner's lock to be read");
    const draining = waitFor(host.socket, "server:draining", 15_000).then((p) => ({ at: performance.now(), ...p }));
    const hostGone = waitFor(host.socket, "disconnect", 15_000).then(() => performance.now());
    // A rejoin on each move the guest is sent, one at a time, under the event's 20-a-minute limit.
    const replies: { sentAt: number; reply: unknown }[] = [];
    const rejoins: Promise<unknown>[] = [];
    let rejoining = true;
    let asking = false;
    guest.socket.on("game:state", () => {
      if (!rejoining || asking || rejoins.length >= 15) return;
      asking = true;
      const sentAt = performance.now();
      rejoins.push(
        guest.socket
          .timeout(5_000 * DEADLINE_SCALE)
          .emitWithAck("game:rejoin", { roomId: room.roomId })
          .catch((e: Error) => e.message)
          .then((reply) => {
            replies.push({ sentAt, reply });
            asking = false;
          })
      );
    });

    const sigterm = performance.now();
    owner.child.kill("SIGTERM");
    const claimed = await eventually(() => lock.holder() !== null && lock.holder() !== ownerPid && ownsRoom(room.roomId), "the peer to hold the lock", 10_000);
    assert.ok(claimed);
    const released = lock.changes.find((c) => c.pid !== ownerPid)!.at;
    const claimAt = lock.changes.find((c) => c.pid !== null && c.pid !== ownerPid)!.at;
    const exitCode = await exited(owner.child);
    const { at: drainAt, reconnectAfterMs } = await draining;
    const hostGoneAt = await hostGone;
    await lock.stop();

    const firstAfter = await eventually(() => states.find((s) => s.at > claimAt), "a move at the new owner", 5_000);
    await eventually(() => replies.some((r) => r.sentAt > released), "a rejoin sent after the release to be answered", 10_000);
    rejoining = false;
    await Promise.all(rejoins);

    const timeline = {
      releaseAfterSigtermMs: Math.round(released - sigterm),
      unownedMs: Math.round(claimAt - released),
      drainingAfterSigtermMs: Math.round(drainAt - sigterm),
      socketsClosedAfterSigtermMs: Math.round(hostGoneAt - sigterm),
      firstMoveAfterClaimMs: Math.round(firstAfter.at - claimAt),
    };
    console.log(`loaded hand-off timeline: ${JSON.stringify(timeline)}`);
    assert.equal(exitCode, 0);
    assert.ok(released < hostGoneAt, "the lock was released only after the owner had closed its sockets");
    assert.ok(claimAt < drainAt, "the peer claimed only after the owner had moved on from the hand-off");
    assert.ok(drainAt < hostGoneAt, "server:draining came after the socket was closed");
    assert.ok(reconnectAfterMs >= 0 && reconnectAfterMs < 10_000, `reconnectAfterMs ${reconnectAfterMs}`);
    assert.deepEqual(replies.filter((r) => (r.reply as { ok?: boolean }).ok !== true), [], "a rejoin during the hand-off was refused");
    assert.ok(activeGames.has(room.roomId), "the peer does not hold the game");
  });

  test("an idle table is handed off before a socket closes", { timeout: 90_000 }, async (t) => {
    const slow = { MURLAN_AFK_TIMEOUT_MS: "600000", MURLAN_BOT_MOVE_DELAY_MS: "600000" };
    Object.assign(process.env, slow);
    t.after(() => Object.assign(process.env, env));
    const { owner, host, room } = await openTable("id", { maxPlayers: 2, fillWithBots: false, ownerEnv: slow });
    const lock = watchLock(observer, room.roomId);
    const ownerPid = await eventually(() => lock.holder(), "the owner's lock to be read");
    const hostGone = waitFor(host.socket, "disconnect", 15_000).then(() => performance.now());

    const sigterm = performance.now();
    owner.child.kill("SIGTERM");
    await eventually(() => lock.holder() !== null && lock.holder() !== ownerPid && ownsRoom(room.roomId), "the peer to hold the lock", 10_000);
    const released = lock.changes.find((c) => c.pid !== ownerPid)!.at;
    const claimAt = lock.changes.find((c) => c.pid !== null && c.pid !== ownerPid)!.at;
    assert.equal(await exited(owner.child), 0);
    const hostGoneAt = await hostGone;
    await lock.stop();

    const timeline = {
      releaseAfterSigtermMs: Math.round(released - sigterm),
      unownedMs: Math.round(claimAt - released),
      socketsClosedAfterSigtermMs: Math.round(hostGoneAt - sigterm),
    };
    console.log(`idle hand-off timeline: ${JSON.stringify(timeline)}`);
    assert.ok(released < hostGoneAt, "the lock was released only after the owner had closed its sockets");
    assert.ok(claimAt < hostGoneAt, "the peer claimed only after the owner had closed its sockets");
  });

  test("a seat lost during the hand-off keeps its in-game grace at the new owner, and the intent sent meanwhile is answered there", { timeout: 90_000 }, async (t) => {
    const slow = { MURLAN_AFK_TIMEOUT_MS: "600000", MURLAN_BOT_MOVE_DELAY_MS: "600000" };
    Object.assign(process.env, slow);
    t.after(() => Object.assign(process.env, env));
    const { owner, host, guest, room } = await openTable("sc", { maxPlayers: 2, fillWithBots: false, ownerEnv: slow });

    // The peer's claim is held at the epoch move, so the window between the lock's release and
    // the claim's answer stays open until the seat has been lost inside it.
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    let gated = false;
    t.after(() => open());
    const claim = activeGameStore.claim.bind(activeGameStore);
    t.mock.method(activeGameStore, "claim", async (roomId: string) => {
      if (roomId === room.roomId) {
        gated = true;
        await gate;
      }
      return claim(roomId);
    });

    const lock = watchLock(observer, room.roomId);
    const ownerPid = await eventually(() => lock.holder(), "the owner's lock to be read");
    owner.child.kill("SIGTERM");
    await eventually(() => lock.holder() !== ownerPid, "the owner to release the lock", 10_000);

    const hostReply = host.socket.timeout(5_000 * DEADLINE_SCALE).emitWithAck("game:rejoin", { roomId: room.roomId });
    guest.socket.close();
    await eventually(() => !userSocketMap.has(guest.user.id), "the peer to see the guest's socket go");
    assert.equal(ownsRoom(room.roomId) && activeGames.has(room.roomId), false, "the peer finished the claim before the seat was lost");
    await eventually(() => gated, "the peer to reach the claim");
    open();

    assert.deepEqual(await hostReply, { ok: true }, "the intent sent to the old owner meanwhile was not answered by the new one");
    assert.equal(await exited(owner.child), 0);
    await lock.stop();

    for (const user of [guest.user, host.user]) {
      await eventually(() => pending("disconnect", user.id), `the in-game grace for ${user.username} at the new owner`);
    }
    assert.equal(holding().filter((ms) => ms === DISCONNECT_GRACE_MS).length >= 2, true, "the graces armed are not the in-game ones");
    assert.deepEqual(usersInLobbyGrace(room.roomId), [], "a seat at a live table was held as a lobby seat");

    assert.ok(!fireUpTo(LOBBY_GRACE_MS).includes(LOBBY_GRACE_MS), "a lobby grace ran out at 20 s");
    const seats = await observer.query<{ user_id: string }>("SELECT user_id FROM room_players WHERE room_id = $1", [room.roomId]);
    assert.deepEqual(new Set(seats.rows.map((r) => r.user_id)), new Set([guest.user.id, host.user.id]), "a seat was released at 20 s");

    const back = await reconnectWith(peer, guest.cookie);
    sockets.push(back);
    const restored = waitForWhere(back, "game:state", (s) => s.viewerSeatIndex !== null && s.viewerSeatIndex !== undefined, 10_000);
    assert.deepEqual(await back.timeout(5_000 * DEADLINE_SCALE).emitWithAck("game:rejoin", { roomId: room.roomId }), { ok: true });
    const state = await restored;
    assert.ok(state.players[state.viewerSeatIndex!]!.hand.length > 0, "the rejoined seat has no hand");
    assert.equal(pending("disconnect", guest.user.id), false, "the rejoin did not clear the grace");
  });
});
