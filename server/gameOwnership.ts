// server/gameOwnership.ts — which instance holds a room's live game.
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
import { Client } from "pg";
import { createHash } from "node:crypto";
import { logger } from "./logger.ts";
import { activeGames } from "./gameRoom.ts";

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

/** Bounds a query on this connection, so a half-open socket fails rather than hangs. */
const OWNERSHIP_QUERY_TIMEOUT_MS = 5_000;

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

/** Rooms this process holds the lock for. */
const held = new Set<string>();

let client: Client | null = null;
let connecting: Promise<Client | null> | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let closed = false;

/**
 * What to do with a room this process was holding and can no longer prove it
 * owns. Registered by the module that can dispose of a game — this one must not
 * import it, or the lock would depend on the table it is protecting.
 */
let onRoomLost: (roomId: string) => void = () => {};

export function setRoomLostHandler(fn: (roomId: string) => void): void {
  onRoomLost = fn;
}

function drop(dead: Client): void {
  if (client !== dead) return;
  client = null;
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
    const next = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL?.includes("neon.tech")
        ? { rejectUnauthorized: false }
        : false,
      query_timeout: OWNERSHIP_QUERY_TIMEOUT_MS,
      statement_timeout: OWNERSHIP_QUERY_TIMEOUT_MS,
    });
    // Registered before the connect so a failure during it lands here rather
    // than as an unhandled 'error' event on a client nobody is listening to.
    next.on("error", (err) => {
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
      if (closed) {
        // A `closeOwnership` that landed while this connect was in flight has
        // already looked at `client` and found nothing. Installing it now would
        // leave a live Postgres connection nothing ever closes, which holds
        // both this room's lock and the process itself open.
        await next.end().catch(() => {});
        return null;
      }
      client = next;
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
      await next.end().catch(() => {});
      return null;
    } finally {
      connecting = null;
    }
  })();
  return connecting;
}

/** Asks Postgres for the lock, whatever this process already believes. */
async function takeLock(roomId: string): Promise<boolean> {
  const c = await connect();
  if (!c) return false;
  try {
    const { rows } = await c.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1::bigint) AS locked",
      [ownershipKey(roomId)]
    );
    return rows[0]?.locked === true;
  } catch (err) {
    logger.error({ err, roomId }, "Could not claim a room");
    return false;
  }
}

/**
 * Takes the locks again after the connection came back, and gives up the rooms
 * that were claimed in the meantime.
 *
 * `held` is walked rather than emptied first: a `disposeGame` racing this would
 * find its room already gone from the set, skip the unlock, and leave the room
 * claimed for the life of the process with no game behind it.
 */
async function reclaim(): Promise<void> {
  for (const roomId of [...held]) {
    if (await takeLock(roomId)) continue;
    held.delete(roomId);
    logger.warn({ roomId }, "Room claimed elsewhere while this instance was disconnected — dropping it");
    onRoomLost(roomId);
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
  if (held.has(roomId)) return true;
  if (!(await takeLock(roomId))) return false;
  held.add(roomId);
  return true;
}

/** Hands a room back, so another instance may take it. */
export async function releaseRoom(roomId: string): Promise<void> {
  if (!held.delete(roomId)) return;
  const c = client;
  if (!c) return;
  await c
    .query("SELECT pg_advisory_unlock($1::bigint)", [ownershipKey(roomId)])
    .catch((err: unknown) => logger.warn({ err, roomId }, "Could not release a room"));
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
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  // The in-flight connect first, then whatever it left behind: reading `client`
  // before waiting reads it a moment too early, and the connection that arrives
  // afterwards is one nothing ever closes.
  await connecting?.catch(() => null);
  const c = client;
  client = null;
  await c?.end().catch((err: unknown) => logger.warn({ err }, "Ownership client close failed"));
}

/** Test seam: undoes `closeOwnership` so one process can boot a second app. */
export function reopenOwnership(): void {
  closed = false;
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
