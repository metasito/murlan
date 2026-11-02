// server/store/presence.ts — where each account is connected and which table its socket sits at,
// kept as state in Redis (ADR 0014, decision 8).
import { randomUUID } from "node:crypto";
import { logger } from "../shared/logger.ts";
import { currentKeyspace, instanceId, openRedis, WatchError, type RedisClient } from "./redis.ts";

export const HEARTBEAT_MS = 3_000;
/** How often this instance fills its entries Redis lost: every beat. */
export const PRESENCE_HEAL_MS = HEARTBEAT_MS;
/** The most entries one heal read asks Redis for, so a large instance never holds Redis for long. */
export const HEAL_CHUNK = 500;

/** `entries` in pieces of at most HEAL_CHUNK, in order; none still makes one piece. */
export function healChunks<T>(entries: readonly T[]): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < entries.length; i += HEAL_CHUNK) chunks.push(entries.slice(i, i + HEAL_CHUNK));
  return chunks.length > 0 ? chunks : [[]];
}
export const INSTANCE_TTL_MS = 10_000;
/** Accounts a sweep claims per transaction, so a large dead instance never holds the sweeper past its own TTL. */
const SWEEP_BATCH = 100;
/** How often a guarded transaction is tried again after its key moved or its link reconnected. */
const GUARD_ATTEMPTS = 5;

export interface Located {
  instance: string;
  socket: string;
  /** Only when asked for: the room this socket is seated in, or null. */
  table?: string | null;
}

export interface PresenceStore {
  readonly id: string;
  /** The newest connection wins: an account holds one socket (`server/CLAUDE.md`). Never rejects. */
  record(userId: string, socketId: string): void;
  /** Only while the entry still names this socket: a replacement's, written since, stays. Never rejects. */
  forget(userId: string, socketId: string): void;
  seat(socketId: string, roomId: string): void;
  unseat(socketId: string): void;
  /**
   * Where each account is connected, for accounts whose instance is alive; anyone else is
   * offline and absent. Rejects while Redis is unreachable.
   */
  locate(userIds: readonly string[], opts?: { tables?: boolean }): Promise<Map<string, Located>>;
  /** How many other instances are alive. Rejects while Redis is unreachable. */
  livePeers(): Promise<number>;
  /** The other instances alive now. Rejects while Redis is unreachable. */
  liveInstances(): Promise<string[]>;
  /** Refreshes this instance's liveness, then clears up after every instance that has none. */
  beat(): Promise<void>;
  /** Called with the accounts this instance found on a dead instance and cleared; each exactly once cluster-wide. */
  onLost(handler: (userIds: string[]) => void): void;
  /** Called with this instance's accounts once it has put back what a sweep, during its lapse, took. */
  onRestored(handler: (userIds: string[]) => void): void;
  /** Marks each account's friend and invite lists as changed. Never rejects; a failed mark is retried on the beat. */
  bumpSocial(userIds: readonly string[]): void;
  /** What the account's lists were last marked with; null when that cannot be known. Rejects while Redis is unreachable. */
  social(userId: string): Promise<string | null>;
  /** Stops reading as alive at once, for a graceful stop: peers stop waiting on it. */
  leave(): void;
  close(): void;
}

const SEPARATOR = "|";

interface Entry {
  instance: string;
  socket: string;
  /** Redis's clock at the connect, in microseconds. */
  at: bigint;
}

function parse(value: string | null | undefined): Entry | null {
  const [instance, socket, at] = value?.split(SEPARATOR) ?? [];
  if (!instance || !socket || !at || !/^\d+$/.test(at)) return null;
  return { instance, socket, at: BigInt(at) };
}

const format = (instance: string, socket: string, at: bigint) => [instance, socket, at].join(SEPARATOR);

export function openPresenceStore({
  id = instanceId,
  url,
  ns = currentKeyspace(),
  heartbeat = true,
  hooks = {},
}: {
  id?: string;
  url?: string;
  ns?: string;
  heartbeat?: boolean;
  /** Where a test makes a race happen: between a guarded read and its EXEC, and before a refill's guarded write. */
  hooks?: { beforeExec?: (keys: string[]) => Promise<void>; beforeRefill?: (userId: string) => Promise<void> };
} = {}): PresenceStore {
  const key = {
    presence: (userId: string) => `${ns}:online:${userId}`,
    table: (socketId: string) => `${ns}:table:${socketId}`,
    instance: (of: string) => `${ns}:instance:${of}`,
    instances: `${ns}:instances`,
    users: (of: string) => `${ns}:instance-users:${of}`,
    social: (userId: string) => `${ns}:social:${userId}`,
    // A counter Redis lost restarts at 1, so a value is read against the store's lifetime too.
    socialEpoch: `${ns}:social-epoch`,
  };
  const client = openRedis("presence", { url, offlineQueue: false });
  // WATCH holds for its connection, so guarded transactions run on their own, one at a time.
  const guarded = openRedis("presence", { url, offlineQueue: false });
  let guardTail: Promise<unknown> = Promise.resolve();

  /** This instance's sockets, each with the stamp Redis gave its connect once it has. */
  const mine = new Map<string, { socketId: string; at?: bigint; written: Promise<void> }>();
  const seats = new Map<string, string>();
  /** Clears that could not reach Redis, retried on every beat. */
  const unforgotten = new Map<string, string>();
  /** Marks that could not reach Redis, retried on every beat. */
  const unbumped = new Set<string>();
  /** The newest stamp Redis has given this instance; 0 before the first. */
  let newestStamp = 0n;
  let lost: (userIds: string[]) => void = () => {};
  let restored: (userIds: string[]) => void = () => {};
  let alive = true;
  const warn = (msg: string) => (err: unknown) => logger.warn({ err }, msg);

  /**
   * Reads `keys` under WATCH and runs what `plan` makes of their values as one transaction;
   * resolves with what `plan` returned, or null when it planned nothing. Another writer moving a
   * key, or the link reconnecting between WATCH and EXEC, reads the keys again.
   */
  function guard<T>(keys: string[], plan: (values: (string | null)[], tx: ReturnType<RedisClient["multi"]>) => T | null): Promise<T | null> {
    const run = guardTail.then(async () => {
      for (let attempt = 1; ; attempt++) {
        try {
          await guarded.watch(keys);
          const values = await guarded.mGet(keys);
          const tx = guarded.multi();
          const planned = plan(values, tx);
          if (planned === null) {
            await guarded.unwatch();
            return null;
          }
          await hooks.beforeExec?.(keys);
          await tx.exec();
          return planned;
        } catch (err) {
          // node-redis keeps a WATCH's epoch across a reconnect until an UNWATCH clears it.
          await guarded.unwatch().catch(() => {});
          if (!(err instanceof WatchError) || attempt >= GUARD_ATTEMPTS) throw err;
        }
      }
    });
    guardTail = run.catch(() => {});
    return run;
  }

  async function stampNow(): Promise<bigint> {
    const [seconds = "0", micros = "0"] = await client.time();
    const at = BigInt(seconds) * 1_000_000n + BigInt(micros);
    if (at > newestStamp) newestStamp = at;
    return at;
  }

  function list(userId: string): Promise<unknown> {
    // Listed before the entry is written, and unlisted only after it is cleared, so the list
    // covers every entry naming this instance whatever fails in between.
    return client.sAdd(key.users(id), userId);
  }

  /** The connect's write: unconditional, the newest connection taking the entry, stamped by Redis's clock. */
  async function connect(userId: string, held: { socketId: string; at?: bigint }): Promise<void> {
    await list(userId);
    const at = await stampNow();
    await client.set(key.presence(userId), format(id, held.socketId, at));
    held.at = at;
  }

  /**
   * Puts back an entry this instance holds unless Redis holds a newer one. A connect that never
   * reached Redis follows the newest stamp this instance has been given; with none, it is stamped
   * now. Stamps survive Redis losing its data, not a failover to a replica whose clock is behind.
   */
  async function refill(userId: string, held: { socketId: string; at?: bigint }): Promise<void> {
    if (mine.get(userId) !== held) return;
    const ours = held.at ?? (newestStamp > 0n ? newestStamp : await stampNow());
    await list(userId);
    await hooks.beforeRefill?.(userId);
    await guard([key.presence(userId)], ([current], tx) => {
      // Again here: the socket may have gone during the awaits above, and a clear is queued behind this.
      if (mine.get(userId) !== held) return null;
      const entry = parse(current);
      if (entry && entry.at >= ours) return null;
      tx.set(key.presence(userId), format(id, held.socketId, ours));
      return true;
    });
  }

  function writeSeat(socketId: string, roomId: string): void {
    void client.set(key.table(socketId), roomId).catch(warn("Could not record the table a socket sits at"));
  }

  /** True when this call removed the entry naming this instance's `socketId`. */
  async function clear(userId: string, socketId: string): Promise<boolean> {
    const cleared = await guard([key.presence(userId)], ([current], tx) => {
      const entry = parse(current);
      if (entry?.instance !== id || entry.socket !== socketId) return null;
      tx.del(key.presence(userId));
      return true;
    });
    // Unlisted only when no entry names this instance for it: cleared, or moved elsewhere.
    if (!mine.has(userId)) await client.sRem(key.users(id), userId);
    return cleared === true;
  }

  function forget(userId: string, socketId: string): void {
    const held = mine.get(userId);
    const written = held?.socketId === socketId ? held.written : Promise.resolve();
    if (held?.socketId === socketId) mine.delete(userId);
    // After its own connect's write, or a late write would put back what this clears.
    void written
      .then(() => clear(userId, socketId))
      .then(
        () => unforgotten.delete(userId),
        (err: unknown) => {
          if (!mine.has(userId)) unforgotten.set(userId, socketId);
          logger.warn({ err, userId }, "Could not clear where an account was connected");
        }
      );
  }

  async function liveAmong(ids: readonly string[]): Promise<Set<string>> {
    const others = ids.filter((i) => i !== id);
    const live = new Set(ids.includes(id) && alive ? [id] : []);
    if (others.length === 0) return live;
    const found = await client.mGet(others.map(key.instance));
    others.forEach((other, i) => {
      if (found[i] !== null) live.add(other);
    });
    return live;
  }

  async function liveInstances(): Promise<string[]> {
    const members = await client.sMembers(key.instances);
    return [...(await liveAmong(members))].filter((m) => m !== id);
  }

  async function locate(userIds: readonly string[], { tables = false } = {}): Promise<Map<string, Located>> {
    const where = new Map<string, Located>();
    if (userIds.length === 0) return where;
    const entries = (await client.mGet(userIds.map(key.presence))).map(parse);
    const live = await liveAmong([...new Set(entries.flatMap((e) => (e ? [e.instance] : [])))]);
    userIds.forEach((userId, i) => {
      const entry = entries[i];
      if (!entry || !live.has(entry.instance)) return;
      // This instance's own sockets are known here first-hand, an entry whose clear has not landed yet included.
      if (entry.instance === id && mine.get(userId)?.socketId !== entry.socket) return;
      where.set(userId, { instance: entry.instance, socket: entry.socket });
    });
    if (tables && where.size > 0) {
      const located = [...where.values()];
      const rooms = await client.mGet(located.map((l) => key.table(l.socket)));
      located.forEach((l, i) => (l.table = rooms[i] ?? null));
    }
    return where;
  }

  /**
   * Clears a dead instance's entries, a batch to a transaction; the delete that succeeds is what
   * makes this instance the one to report it. Its listing and its place in `instances` go only
   * while it still has no liveness: one that came back keeps both. Its inbox is left to its own
   * expiry, so one that came back loses nothing queued for it.
   */
  async function sweep(dead: string): Promise<void> {
    const users = await client.sMembers(key.users(dead));
    for (let i = 0; i < users.length; i += SWEEP_BATCH) {
      const batch = users.slice(i, i + SWEEP_BATCH);
      const took = await guard([key.instance(dead), ...batch.map(key.presence)], ([liveness, ...values], tx) => {
        if (liveness !== null) return null;
        const ids: string[] = [];
        values.forEach((value, j) => {
          const entry = parse(value);
          if (entry?.instance !== dead) return;
          tx.del([key.presence(batch[j]!), key.table(entry.socket)]);
          ids.push(batch[j]!);
        });
        return ids.length > 0 ? ids : null;
      });
      // Told per batch: a later batch failing must not cost these their friends' notice.
      if (took) lost(took);
    }
    await guard([key.instance(dead)], ([liveness], tx) => {
      if (liveness !== null) return null;
      tx.del(key.users(dead)).sRem(key.instances, dead);
      return true;
    });
  }

  function markEpoch(): Promise<unknown> {
    return client.set(key.socialEpoch, randomUUID(), { condition: "NX" });
  }

  async function bump(userIds: Iterable<string>): Promise<void> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return;
    const batch = client.multi();
    for (const userId of ids) batch.incr(key.social(userId));
    try {
      await batch.execAsPipeline();
      for (const userId of ids) unbumped.delete(userId);
    } catch (err) {
      for (const userId of ids) unbumped.add(userId);
      throw err;
    }
  }

  async function beat(): Promise<void> {
    if (!alive) return;
    await markEpoch();
    const [was, , listed] = await client
      .multi()
      .set(key.instance(id), "1", { expiration: { type: "PX", value: INSTANCE_TTL_MS }, GET: true })
      .sAdd(key.instances, id)
      .exists(key.users(id))
      .execAsPipeline();
    // Lapsed (a stall, a partition, a Redis restart) or swept by a peer that saw it lapse: a sweep
    // can land after the restore, and then its deleted list is what the next beat sees.
    // So a connect refused meanwhile refills with a stamp no older than this beat.
    await stampNow();
    if (was === null || (Number(listed) === 0 && mine.size > 0)) {
      await restore();
      // A peer that swept this instance told its friends these accounts went offline.
      if (mine.size > 0) restored([...mine.keys()]);
    } else {
      await heal();
    }
    for (const [userId, socketId] of [...unforgotten]) {
      if (mine.has(userId)) unforgotten.delete(userId);
      else if ((await clear(userId, socketId).catch(() => null)) !== null) unforgotten.delete(userId);
    }
    if (unbumped.size > 0) await bump(unbumped).catch(warn("Could not mark friend lists as changed"));
    const members = await client.sMembers(key.instances);
    const live = await liveAmong(members);
    for (const member of members) {
      if (!live.has(member)) await sweep(member);
    }
  }

  /** Fills any of this instance's entries Redis no longer holds, and only those. */
  async function heal(): Promise<void> {
    for (const chunk of healChunks([...mine])) {
      if (chunk.length === 0) continue;
      const values = await client.mGet(chunk.map(([userId]) => key.presence(userId)));
      await Promise.all(
        chunk.flatMap(([userId, h], i) =>
          values[i] === null ? [refill(userId, h).catch(warn("Could not put back where an account is connected"))] : []
        )
      );
    }
  }

  async function restore(): Promise<void> {
    await Promise.all([...mine].map(([userId, held]) => refill(userId, held).catch(warn("Could not put back where an account is connected"))));
    for (const [socketId, roomId] of seats) writeSeat(socketId, roomId);
  }

  client.on("ready", () => {
    void markEpoch().catch(warn("Could not mark the store's lifetime"));
    void restore();
    if (heartbeat) void beat().catch(warn("Presence heartbeat failed"));
  });

  let beating: Promise<void> | null = null;
  const timer = heartbeat
    ? setInterval(() => {
        if (!client.isOpen) return clearInterval(timer);
        if (beating) return;
        beating = beat()
          .catch(warn("Presence heartbeat failed"))
          .finally(() => (beating = null));
      }, HEARTBEAT_MS)
    : undefined;
  (timer as unknown as { unref?: () => void } | undefined)?.unref?.();

  return {
    id,
    record(userId, socketId) {
      const held: { socketId: string; at?: bigint; written: Promise<void> } = { socketId, written: Promise.resolve() };
      held.written = connect(userId, held).catch(warn("Could not record where an account is connected"));
      mine.set(userId, held);
      unforgotten.delete(userId);
    },
    forget,
    seat(socketId, roomId) {
      seats.set(socketId, roomId);
      writeSeat(socketId, roomId);
    },
    unseat(socketId) {
      if (!seats.delete(socketId)) return;
      void client.del(key.table(socketId)).catch(warn("Could not clear the table a socket sat at"));
    },
    locate,
    bumpSocial(userIds) {
      void bump(userIds).catch(warn("Could not mark friend lists as changed"));
    },
    async social(userId) {
      const [epoch, count] = await client.mGet([key.socialEpoch, key.social(userId)]);
      return epoch ? `${epoch}.${count ?? 0}` : null;
    },
    async livePeers() {
      return (await liveInstances()).length;
    },
    liveInstances,
    beat,
    onLost(handler) {
      lost = handler;
    },
    onRestored(handler) {
      restored = handler;
    },
    leave() {
      alive = false;
      clearInterval(timer);
      void client.del(key.instance(id)).catch(warn("Could not mark this instance as leaving"));
    },
    close() {
      clearInterval(timer);
      client.destroy();
      guarded.destroy();
    },
  };
}

let store: PresenceStore | null = null;
let lostHandler: (userIds: string[]) => void = () => {};
let restoredHandler: (userIds: string[]) => void = () => {};

/** Opened at boot; until then, and after `closePresence`, nothing is recorded and nobody is found. */
export function openPresence(url?: string): PresenceStore {
  if (store) return store;
  store = openPresenceStore({ url });
  store.onLost(lostHandler);
  store.onRestored(restoredHandler);
  return store;
}

export function closePresence(): void {
  store?.close();
  store = null;
}

export function leavePresence(): void {
  store?.leave();
}

export function onPresenceLost(handler: (userIds: string[]) => void): void {
  lostHandler = handler;
  store?.onLost(handler);
}

export function onPresenceRestored(handler: (userIds: string[]) => void): void {
  restoredHandler = handler;
  store?.onRestored(handler);
}

export function recordPresence(userId: string, socketId: string): void {
  store?.record(userId, socketId);
}

export function forgetPresence(userId: string, socketId: string): void {
  store?.forget(userId, socketId);
}

export function seatPresence(socketId: string, roomId: string): void {
  store?.seat(socketId, roomId);
}

export function unseatPresence(socketId: string): void {
  store?.unseat(socketId);
}

export function presenceKey(userId: string): string {
  return `${currentKeyspace()}:online:${userId}`;
}

function opened(): PresenceStore {
  if (!store) throw new Error("presence is not open");
  return store;
}

export function locate(userIds: readonly string[], opts?: { tables?: boolean }): Promise<Map<string, Located>> {
  return opened().locate(userIds, opts);
}

/** The instance each account is connected to; an account with no live entry is absent. */
export async function instancesOf(userIds: readonly string[]): Promise<Map<string, string>> {
  return new Map([...(await locate(userIds))].map(([userId, l]) => [userId, l.instance]));
}

export function livePeers(): Promise<number> {
  return opened().livePeers();
}

export function liveInstances(): Promise<string[]> {
  return opened().liveInstances();
}

export function bumpSocial(userIds: readonly string[]): void {
  store?.bumpSocial(userIds);
}

export function socialVersion(userId: string): Promise<string | null> {
  return opened().social(userId);
}
