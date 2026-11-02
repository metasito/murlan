// server/game/gameOwnership.ts — which instance holds a room's live game.
//
// `activeGames` is a per-process Map, so with two instances two of them can
// hold the same room and each broadcasts over the other. The claim below makes
// that impossible: a room is owned by whoever holds its Postgres advisory
// lock, and only the owner keeps it in memory.
//
// A lock rather than an `owner_instance` column with a lease: a lease needs a
// heartbeat, an expiry to tune and a takeover rule, and every one of those is a
// way to end up with two owners while believing there is one. Postgres drops a
// session lock when the connection dies, so a crashed owner releases its rooms
// with nothing to tune and no timer to get wrong.
//
// The lock cannot stop a write the previous owner already has in flight, so the
// row carries an epoch each claim moves on (`enterTable`), and every row write
// is made under it (`writeAsOwner`).
import type { Client } from "pg";
import { createClient } from "../store/pool.ts";
import { createHash } from "node:crypto";
import { logger } from "../shared/logger.ts";
import { clearTableOwner, recordTableOwner } from "../store/tableOwners.ts";
import { activeGames } from "./gameRoom.ts";
import type { TableStore } from "./tableRuntime.ts";

type OwnedRows = Pick<TableStore["games"], "claim" | "load" | "epochOf">;
type ActiveGameRow = NonNullable<Awaited<ReturnType<OwnedRows["load"]>>>;
type OwnerFence = Parameters<TableStore["games"]["write"]>[2];

/**
 * The advisory-lock key for a room, as `pg_try_advisory_lock` takes it.
 *
 * Sixty-four bits of sha1 rather than Postgres' own `hashtext`, which is
 * thirty-two: two rooms colliding would leave the second unable to claim a
 * table it does own, and at 2^32 that is a coin flip somewhere in the first
 * hundred thousand rooms.
 */
export function ownershipKey(roomId: string): string {
  return createHash("sha1").update(roomId).digest().readBigInt64BE(0).toString();
}

/**
 * How often the connection is proved alive.
 *
 * The lock is only as good as this process's belief that it still holds it, and
 * a connection can die without anything on this side noticing — a partition
 * between the app and Postgres leaves the socket half-open, Postgres reaps the
 * backend and hands every lock back, and this process carries on playing the
 * tables it no longer owns. A read that fails is what turns that into a
 * reconcile.
 */
const OWNERSHIP_HEARTBEAT_MS = 15_000;

/** How soon a reclaim that could not reach Postgres, as during its restart, tries again. */
const OWNERSHIP_RECLAIM_RETRY_MS = 1_000;

/** How long a reconnected client waits for the session it replaced to leave Postgres. */
const PREDECESSOR_WAIT_MS = 3_000;
const PREDECESSOR_POLL_MS = 100;

interface Hold {
  /** The session the lock was granted on; a reclaim asks again only on a newer one. */
  lockedOn: Client | null;
  /** Set by `enterTable`; until then the room has no row of its own to write. */
  fence: OwnerFence | null;
  entering: Promise<ActiveGameRow | undefined> | null;
}

/** Rooms this process holds the lock for. */
const held = new Map<string, Hold>();

/** Exact, and the same text in every session whatever its `TimeZone` or `DateStyle`. */
const STARTED = "extract(epoch FROM backend_start)::text";

/** A backend as `pg_stat_activity` names it: a pid alone may since belong to another session. */
interface Backend {
  pid: number;
  started: string;
}

let backend: Backend | null = null;
/** Sessions this process dropped and has not yet seen leave Postgres; their locks are still its own. */
const predecessors: Backend[] = [];
let retiring: Promise<boolean> | null = null;

/** Rooms whose lock is kept until what it guards has settled; see `releaseRoomAfter`. */
const releasing = new Map<string, Promise<void>>();

let client: Client | null = null;
let connecting: Promise<Client | null> | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let reclaimRetry: ReturnType<typeof setTimeout> | null = null;
let closed = false;

/**
 * What to do with a room this process was holding and can no longer prove it
 * owns. Handed in by the table runtime — this module must not import disposal,
 * or the lock would depend on the table it is protecting.
 */
let onRoomLost: (roomId: string) => void = () => {};
let rows: OwnedRows | null = null;

function drop(dead: Client): void {
  if (client !== dead) return;
  client = null;
  if (backend) predecessors.push(backend);
  backend = null;
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  void dead.end().catch(() => {});
  void reclaim();
}

function connect(): Promise<Client | null> {
  if (closed) return Promise.resolve(null);
  if (client) return Promise.resolve(client);
  if (connecting) return connecting;
  connecting = (async () => {
    const next = createClient("ownership", (err) => {
      logger.error({ err }, "Game ownership connection failed — every claimed room is now unowned");
      drop(next);
    });
    try {
      await next.connect();
      // How fast a table can be taken over from an instance that vanished
      // without closing anything — a killed container, a partitioned network.
      // A process that exits sends a FIN and Postgres drops its locks at once;
      // one that simply stops answering is invisible until the server probes,
      // and the default is two hours. Best effort: a server that does not
      // support them accepts the SET and ignores it, and one that refuses it
      // outright must not cost us the connection.
      await next
        .query(
          "SET tcp_keepalives_idle = 20; SET tcp_keepalives_interval = 5; SET tcp_keepalives_count = 3"
        )
        .catch((err: unknown) =>
          logger.warn({ err }, "Could not shorten the ownership connection's keepalives")
        );
      const self = await next.query<Backend>(
        `SELECT pid, ${STARTED} AS started FROM pg_stat_activity WHERE pid = pg_backend_pid()`
      );
      if (closed) {
        // A `closeOwnership` that landed while this connect was in flight has
        // already looked at `client` and found nothing. Installing it now would
        // leave a live Postgres connection nothing ever closes, which holds
        // both this room's lock and the process itself open.
        await next.end().catch(() => {});
        return null;
      }
      client = next;
      backend = self.rows[0] ?? null;
      heartbeat = setInterval(() => {
        void next.query("SELECT 1").catch((err: unknown) => {
          logger.error({ err }, "Game ownership connection stopped answering");
          drop(next);
        });
      }, OWNERSHIP_HEARTBEAT_MS);
      (heartbeat as unknown as { unref?: () => void }).unref?.();
      return next;
    } catch (err) {
      logger.error({ err }, "Could not connect the game ownership client");
      // Not awaited: a client whose flow died after connecting waits for the server's reply to
      // its goodbye until TCP gives up, and every claim waits on this connect.
      void next.end().catch(() => {});
      return null;
    } finally {
      connecting = null;
    }
  })();
  return connecting;
}

/**
 * Postgres' answer to one lock request. `unreachable` is a question nobody answered — a refused
 * connection, a failed query — and says nothing about who holds the room.
 */
type LockAnswer = "taken" | "elsewhere" | "unreachable";

/**
 * Whether every session this process dropped has left Postgres, terminating any still there.
 * Until one has, a lock it held reads as held elsewhere when it is this process's own.
 */
function retirePredecessors(c: Client): Promise<boolean> {
  if (predecessors.length === 0) return Promise.resolve(true);
  retiring ??= (async () => {
    const alive = (b: Backend) =>
      c
        .query(`SELECT pid FROM pg_stat_activity WHERE pid = $1 AND ${STARTED} = $2`, [b.pid, b.started])
        .then(({ rows }) => rows.length > 0);
    try {
      for (const b of predecessors) {
        await c.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid = $1 AND ${STARTED} = $2`,
          [b.pid, b.started]
        );
      }
      for (let polls = PREDECESSOR_WAIT_MS / PREDECESSOR_POLL_MS; ; polls--) {
        const remaining: Backend[] = [];
        for (const b of predecessors) if (await alive(b)) remaining.push(b);
        predecessors.splice(0, predecessors.length, ...remaining);
        if (remaining.length === 0) return true;
        if (polls === 0) {
          logger.warn({ pids: remaining.map((b) => b.pid) }, "A dropped ownership session is still alive");
          return false;
        }
        await new Promise((resolve) => setTimeout(resolve, PREDECESSOR_POLL_MS));
      }
    } catch (err) {
      logger.error({ err }, "Could not end a dropped ownership session");
      return false;
    } finally {
      retiring = null;
    }
  })();
  return retiring;
}

/** Asks Postgres for the lock, whatever this process already believes. */
async function takeLock(roomId: string): Promise<{ answer: LockAnswer; on: Client | null }> {
  const c = await connect();
  if (!c) return { answer: "unreachable", on: null };
  const alone = await retirePredecessors(c);
  try {
    const { rows } = await c.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1::bigint) AS locked",
      [ownershipKey(roomId)]
    );
    if (rows[0]?.locked === true) return { answer: "taken", on: c };
    return { answer: alone ? "elsewhere" : "unreachable", on: null };
  } catch (err) {
    logger.error({ err, roomId }, "Could not claim a room");
    return { answer: "unreachable", on: null };
  }
}

/**
 * Gives up a room this process can no longer prove it owns, and hands it to `onRoomLost`.
 * `unlock` when this session may still hold the lock: the row moved, but the lock did not.
 */
function loseRoom(roomId: string, hold: Hold, unlock: boolean): void {
  if (held.get(roomId) !== hold) return;
  held.delete(roomId);
  if (hold.fence) clearTableOwner(roomId, hold.fence.epoch);
  const c = client;
  if (unlock && c && hold.lockedOn === c) {
    void c
      .query("SELECT pg_advisory_unlock($1::bigint)", [ownershipKey(roomId)])
      .catch((err: unknown) => logger.warn({ err, roomId }, "Could not release a lost room"));
  }
  onRoomLost(roomId);
}

/** Whether the row still carries this claim's epoch; a missing row is left to the next write's fence. */
async function rowStillMine(roomId: string, fence: OwnerFence): Promise<boolean> {
  if (!rows) throw new Error("ownership was never opened");
  const epoch = await rows.epochOf(roomId);
  return epoch === undefined || epoch === fence.epoch;
}

/**
 * Takes the locks again after the connection came back, and gives up the rooms
 * that were claimed in the meantime: held elsewhere, or entered at a newer epoch.
 * It moves no epoch: it is the same claim, on a new session.
 *
 * `held` is walked rather than emptied first: a `disposeGame` racing this would
 * find its room already gone from the set, skip the unlock, and leave the room
 * claimed for the life of the process with no game behind it.
 */
async function reclaim(): Promise<void> {
  let unreachable = false;
  for (const [roomId, hold] of [...held]) {
    if (held.get(roomId) !== hold) continue;
    if (!hold.lockedOn || hold.lockedOn !== client) {
      const { answer, on } = await takeLock(roomId);
      if (answer === "unreachable") {
        unreachable = true;
        continue;
      }
      if (answer === "elsewhere") {
        logger.warn({ roomId }, "Room claimed elsewhere while this instance was disconnected — dropping it");
        loseRoom(roomId, hold, false);
        continue;
      }
      hold.lockedOn = on;
    }
    const fence = hold.fence;
    if (!fence) continue;
    let mine: boolean;
    try {
      mine = await rowStillMine(roomId, fence);
    } catch (err) {
      logger.error({ err, roomId }, "Could not read a reclaimed room's epoch");
      unreachable = true;
      continue;
    }
    if (mine) continue;
    logger.warn({ roomId, epoch: fence.epoch }, "Room entered elsewhere while this instance was disconnected — dropping it");
    loseRoom(roomId, hold, true);
  }
  if (unreachable && !closed && !reclaimRetry) {
    reclaimRetry = setTimeout(() => {
      reclaimRetry = null;
      void reclaim();
    }, OWNERSHIP_RECLAIM_RETRY_MS);
    (reclaimRetry as unknown as { unref?: () => void }).unref?.();
  }
}

/**
 * Takes ownership of a room, or reports that someone else holds it.
 *
 * `pg_try_advisory_lock` is re-entrant within a session, so asking twice would
 * take the lock twice and one unlock would not release it. `held` is what makes
 * the second call free and the single unlock correct.
 */
export async function claimRoom(roomId: string): Promise<boolean> {
  if (releasing.has(roomId)) return false;
  if (held.has(roomId)) return true;
  const { answer, on } = await takeLock(roomId);
  if (answer !== "taken") return false;
  held.set(roomId, { lockedOn: on, fence: null, entering: null });
  return true;
}

/**
 * Makes this claim the owner of the room's row, and reads the row: one statement moves its epoch
 * on, so a write made under any earlier claim changes nothing from here. A claim enters once; a
 * room it already entered is read as it stands. With no row, the claim's epoch is 1 and its
 * first write is the insert. Called where a game enters memory, never by `claimRoom`, so a
 * claim that only probes ownership moves nothing.
 */
export async function enterTable(roomId: string): Promise<{ held: false } | { held: true; row: ActiveGameRow | undefined }> {
  const hold = held.get(roomId);
  if (!hold || !rows) return { held: false };
  if (hold.fence) return { held: true, row: await rows.load(roomId) };
  const store = rows;
  hold.entering ??= (async () => {
    try {
      const claimed = await store.claim(roomId);
      if (held.get(roomId) === hold) {
        hold.fence = { epoch: claimed?.ownerEpoch ?? 1, rowExists: claimed !== undefined };
        recordTableOwner(roomId, hold.fence.epoch);
      }
      return claimed && { roomId, gameState: claimed.gameState };
    } finally {
      hold.entering = null;
    }
  })();
  const row = await hold.entering;
  return held.get(roomId) === hold && hold.fence ? { held: true, row } : { held: false };
}

/**
 * Runs a write of the room's row under this claim's epoch: the one way a table's row is written
 * or deleted. A write that changes nothing the row should have had means another claim owns the
 * row: the room is given up through `onRoomLost`, and nothing more is written. `leaves` is
 * whether the row exists once the write lands. False whenever nothing was written.
 */
export async function writeAsOwner(
  roomId: string,
  leaves: "row" | "no row",
  write: (fence: OwnerFence) => Promise<boolean>
): Promise<boolean> {
  const hold = held.get(roomId);
  const fence = hold?.fence;
  if (!hold || !fence) {
    if (hold) logger.error({ roomId }, "A table write before its claim entered the row — not written");
    return false;
  }
  const changed = await write(fence);
  if (held.get(roomId) !== hold) return changed;
  if (changed) {
    fence.rowExists = leaves === "row";
    return true;
  }
  // Deleting a row this claim never saw finds nothing, and that is no sign of another owner.
  if (leaves === "no row" && !fence.rowExists) return false;
  logger.warn({ roomId, epoch: fence.epoch }, "Another claim owns this table's row — giving the table up");
  loseRoom(roomId, hold, true);
  return false;
}

/** Hands a room back, so another instance may take it — unless `releaseRoomAfter` is holding it. */
export async function releaseRoom(roomId: string): Promise<void> {
  if (releasing.has(roomId)) return;
  await unlock(roomId);
}

async function unlock(roomId: string): Promise<void> {
  const hold = held.get(roomId);
  if (!hold) return;
  held.delete(roomId);
  if (hold.fence) clearTableOwner(roomId, hold.fence.epoch);
  const c = client;
  if (!c) return;
  await c
    .query("SELECT pg_advisory_unlock($1::bigint)", [ownershipKey(roomId)])
    .catch((err: unknown) => logger.warn({ err, roomId }, "Could not release a room"));
}

/**
 * Hands a room back once `settled` has, and refuses every claim on it until then — this
 * process's own too, which the re-entrant lock would otherwise grant at once. For a room whose
 * row is being deleted: a claim landing first restores the table from that row.
 */
export function releaseRoomAfter(roomId: string, settled: Promise<unknown>): Promise<void> {
  const released: Promise<void> = settled
    .catch(() => {})
    .then(() => (releasing.get(roomId) === released ? unlock(roomId) : undefined))
    .finally(() => {
      if (releasing.get(roomId) === released) releasing.delete(roomId);
    });
  releasing.set(roomId, released);
  return released;
}

/** Whether this process's ownership session is open, and so visible in `pg_stat_activity`. */
export function ownershipConnected(): boolean {
  return client !== null;
}

/** Whether this process currently claims the room. */
export function ownsRoom(roomId: string): boolean {
  return held.has(roomId);
}

/**
 * Closes the ownership connection. Every lock on it goes with it, which is the
 * point — a process on its way out must not keep other instances off its
 * tables. Call it only once nothing is still playing them.
 */
export async function closeOwnership(): Promise<void> {
  closed = true;
  held.clear();
  predecessors.length = 0;
  backend = null;
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  if (reclaimRetry) {
    clearTimeout(reclaimRetry);
    reclaimRetry = null;
  }
  // The in-flight connect first, then whatever it left behind: reading `client`
  // before waiting reads it a moment too early, and the connection that arrives
  // afterwards is one nothing ever closes.
  await connecting?.catch(() => null);
  const c = client;
  client = null;
  await c?.end().catch((err: unknown) => logger.warn({ err }, "Ownership client close failed"));
}

/** Opens ownership for a table runtime; also what lets one process boot a second app after `closeOwnership`. */
export function reopenOwnership(handlers: { onRoomLost: (roomId: string) => void; rows: OwnedRows }): void {
  closed = false;
  onRoomLost = handlers.onRoomLost;
  rows = handlers.rows;
}

/**
 * The rooms this process holds in memory but has no claim on.
 *
 * Only reachable through a bug — every path that puts a game in `activeGames`
 * claims the room first — but what it would be reporting is two instances
 * broadcasting one table over each other, so it is checked rather than assumed.
 */
export function unclaimedRooms(): string[] {
  return [...activeGames.keys()].filter((roomId) => !held.has(roomId));
}
