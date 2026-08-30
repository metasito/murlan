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

/**
 * Rooms this process believes it owns. Believes, not knows: the connection can
 * drop, and Postgres releases every lock on it when that happens.
 */
const held = new Set<string>();

let client: Client | null = null;
let connecting: Promise<Client | null> | null = null;
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
    });
    // Registered before the connect so a failure during it lands here rather
    // than as an unhandled 'error' event on a client nobody is listening to.
    next.on("error", (err) => {
      logger.error({ err }, "Game ownership connection failed — every claimed room is now unowned");
      if (client === next) client = null;
      void reclaim();
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
      client = next;
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

/**
 * Takes the locks again after the connection came back, and gives up the rooms
 * that were claimed in the meantime.
 *
 * Without this a dropped connection is silent: Postgres released the locks, so
 * another instance can claim a room this one is still broadcasting for, and
 * both then persist over each other.
 */
async function reclaim(): Promise<void> {
  const rooms = [...held];
  held.clear();
  for (const roomId of rooms) {
    if (await claimRoom(roomId)) continue;
    logger.warn({ roomId }, "Room claimed elsewhere while this instance was disconnected — dropping it");
    onRoomLost(roomId);
  }
}

/**
 * Takes ownership of a room, or reports that someone else holds it.
 *
 * Idempotent for the holder: `pg_try_advisory_lock` is re-entrant within a
 * session, so a second call from the owner succeeds and takes the lock a second
 * time — which is why `held` is consulted first rather than counting unlocks.
 */
export async function claimRoom(roomId: string): Promise<boolean> {
  if (held.has(roomId)) return true;
  const c = await connect();
  if (!c) return false;
  try {
    const { rows } = await c.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1::bigint) AS locked",
      [ownershipKey(roomId)]
    );
    if (!rows[0]?.locked) return false;
    held.add(roomId);
    return true;
  } catch (err) {
    logger.error({ err, roomId }, "Could not claim a room");
    return false;
  }
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

/** Test seam: whether this process currently claims the room. */
export function ownsRoom(roomId: string): boolean {
  return held.has(roomId);
}

/**
 * Closes the ownership connection. Every lock on it goes with it, which is the
 * point — a process on its way out must not keep other instances off its
 * tables.
 */
export async function closeOwnership(): Promise<void> {
  closed = true;
  held.clear();
  const c = client;
  client = null;
  await connecting?.catch(() => null);
  await c?.end().catch((err: unknown) => logger.warn({ err }, "Ownership client close failed"));
}

/** Test seam: undoes `closeOwnership` so one process can boot a second app. */
export function reopenOwnership(): void {
  closed = false;
}

/**
 * The rooms this process holds in memory but has no claim on.
 *
 * Only ever non-empty through a bug: every path that puts a game in
 * `activeGames` claims first. Reported by the sweeper rather than asserted, so
 * a divergence is visible in production instead of only in a test.
 */
export function unclaimedRooms(): string[] {
  return [...activeGames.keys()].filter((roomId) => !held.has(roomId));
}
