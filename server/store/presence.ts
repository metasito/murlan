// server/store/presence.ts — where each account is connected and which table its socket sits at,
// kept as state in Redis (ADR 0014, decision 8).
import { randomUUID } from "node:crypto";
import { logger } from "../shared/logger.ts";
import { currentKeyspace, instanceId, openRedis, WatchError } from "./redis.ts";

export const HEARTBEAT_MS = 3_000;
export const INSTANCE_TTL_MS = 10_000;

export interface Located {
  instance: string;
  socket: string;
  /** Only when asked for: the room this socket is seated in, or null. */
  table?: string | null;
}

export interface PresenceStore {
  readonly id: string;
  /** The newest socket wins: an account holds one socket (`server/CLAUDE.md`). Never rejects. */
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
  /** Refreshes this instance's liveness, then clears up after every instance that has none. */
  beat(): Promise<void>;
  /** Called with the accounts this instance found on a dead instance and cleared; each exactly once cluster-wide. */
  onLost(handler: (userIds: string[]) => void): void;
  /** Marks each account's friend and invite lists as changed. Never rejects. */
  bumpSocial(userIds: readonly string[]): void;
  /** What the account's lists were last marked with; null when that cannot be known. Rejects while Redis is unreachable. */
  social(userId: string): Promise<string | null>;
  /** Stops reading as alive at once, for a graceful stop: peers stop waiting on it. */
  leave(): void;
  close(): void;
}

const SEPARATOR = "|";

function parse(value: string | null | undefined): { instance: string; socket: string } | null {
  if (!value) return null;
  const at = value.indexOf(SEPARATOR);
  return at > 0 ? { instance: value.slice(0, at), socket: value.slice(at + 1) } : null;
}

export function openPresenceStore({
  id = instanceId,
  url,
  ns = currentKeyspace(),
  heartbeat = true,
}: { id?: string; url?: string; ns?: string; heartbeat?: boolean } = {}): PresenceStore {
  const key = {
    // Not `presence:`, which an instance on the hash format still writes during a rolling deploy.
    presence: (userId: string) => `${ns}:online:${userId}`,
    table: (socketId: string) => `${ns}:table:${socketId}`,
    instance: (of: string) => `${ns}:instance:${of}`,
    instances: `${ns}:instances`,
    users: (of: string) => `${ns}:instance-users:${of}`,
    inbox: (of: string) => `${ns}:inbox:${of}`,
    social: (userId: string) => `${ns}:social:${userId}`,
    // A counter Redis lost restarts at 1, so a value is read against the store's lifetime too.
    socialEpoch: `${ns}:social-epoch`,
  };
  const client = openRedis("presence", { url, offlineQueue: false });
  // WATCH holds for its connection, so compare-and-delete runs on its own, one at a time.
  const guarded = openRedis("presence", { url, offlineQueue: false });
  let guardTail: Promise<unknown> = Promise.resolve();

  /** This instance's sockets and seats, so what Redis lost while it was away is put back. */
  const mine = new Map<string, string>();
  const seats = new Map<string, string>();
  /** Clears that could not reach Redis, retried on every beat. */
  const unforgotten = new Map<string, string>();
  let lost: (userIds: string[]) => void = () => {};
  let alive = true;
  const warn = (msg: string) => (err: unknown) => logger.warn({ err }, msg);

  /** True when this call removed `key` holding `expected`: of racing callers, exactly one. */
  function deleteIfEqual(k: string, expected: string): Promise<boolean> {
    const run = guardTail.then(async () => {
      await guarded.watch(k);
      if ((await guarded.get(k)) !== expected) {
        await guarded.unwatch();
        return false;
      }
      try {
        const [deleted] = await guarded.multi().del(k).exec();
        return Number(deleted) === 1;
      } catch (err) {
        if (err instanceof WatchError) return false;
        throw err;
      }
    });
    guardTail = run.catch(() => {});
    return run;
  }

  function write(userId: string, socketId: string, { onlyIfMissing = false } = {}): void {
    // Listed before the entry is written, and unlisted only after it is cleared, so the list
    // covers every entry naming this instance whatever fails in between.
    void client.sAdd(key.users(id), userId).catch(warn("Could not list an account under this instance"));
    void client
      .set(key.presence(userId), `${id}${SEPARATOR}${socketId}`, onlyIfMissing ? { condition: "NX" } : undefined)
      .catch(warn("Could not record where an account is connected"));
  }

  function writeSeat(socketId: string, roomId: string): void {
    void client.set(key.table(socketId), roomId).catch(warn("Could not record the table a socket sits at"));
  }

  async function clear(userId: string, socketId: string): Promise<boolean> {
    const cleared = await deleteIfEqual(key.presence(userId), `${id}${SEPARATOR}${socketId}`);
    if (cleared && !mine.has(userId)) await client.sRem(key.users(id), userId);
    return cleared;
  }

  function forget(userId: string, socketId: string): void {
    if (mine.get(userId) === socketId) mine.delete(userId);
    void clear(userId, socketId).then(
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

  async function locate(userIds: readonly string[], { tables = false } = {}): Promise<Map<string, Located>> {
    const where = new Map<string, Located>();
    if (userIds.length === 0) return where;
    const entries = (await client.mGet(userIds.map(key.presence))).map(parse);
    const live = await liveAmong([...new Set(entries.flatMap((e) => (e ? [e.instance] : [])))]);
    userIds.forEach((userId, i) => {
      const entry = entries[i];
      if (!entry || !live.has(entry.instance)) return;
      // This instance's own sockets are known here first-hand, an entry whose clear has not landed yet included.
      if (entry.instance === id && mine.get(userId) !== entry.socket) return;
      where.set(userId, entry);
    });
    if (tables && where.size > 0) {
      const located = [...where.values()];
      const rooms = await client.mGet(located.map((l) => key.table(l.socket)));
      located.forEach((l, i) => (l.table = rooms[i] ?? null));
    }
    return where;
  }

  /** Clears a dead instance's entries; the delete that succeeds is what makes this instance the one to report it. */
  async function sweep(dead: string): Promise<void> {
    const users = await client.sMembers(key.users(dead));
    const entries = users.length > 0 ? (await client.mGet(users.map(key.presence))).map(parse) : [];
    const claimed: string[] = [];
    const sockets: string[] = [];
    for (const [i, userId] of users.entries()) {
      const entry = entries[i];
      if (entry?.instance !== dead) continue;
      sockets.push(entry.socket);
      if (await deleteIfEqual(key.presence(userId), `${dead}${SEPARATOR}${entry.socket}`)) claimed.push(userId);
    }
    if (sockets.length > 0) await client.del(sockets.map(key.table));
    await client.del([key.users(dead), key.inbox(dead)]);
    await client.sRem(key.instances, dead);
    if (claimed.length > 0) lost(claimed);
  }

  function markEpoch(): Promise<unknown> {
    return client.set(key.socialEpoch, randomUUID(), { condition: "NX" });
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
    if (was === null || (Number(listed) === 0 && mine.size > 0)) restore();
    for (const [userId, socketId] of [...unforgotten]) {
      if (mine.has(userId)) unforgotten.delete(userId);
      else if (await clear(userId, socketId).catch(() => null) !== null) unforgotten.delete(userId);
    }
    const members = await client.sMembers(key.instances);
    const live = await liveAmong(members);
    for (const member of members) {
      if (!live.has(member)) await sweep(member);
    }
  }

  function restore(): void {
    // Only into a missing entry: while this instance was away the account may have connected
    // elsewhere, and that newer entry is the one its messages must follow.
    for (const [userId, socketId] of mine) write(userId, socketId, { onlyIfMissing: true });
    for (const [socketId, roomId] of seats) writeSeat(socketId, roomId);
  }

  client.on("ready", () => {
    void markEpoch().catch(warn("Could not mark the store's lifetime"));
    restore();
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
      mine.set(userId, socketId);
      unforgotten.delete(userId);
      write(userId, socketId);
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
      if (userIds.length === 0) return;
      const batch = client.multi();
      for (const userId of new Set(userIds)) batch.incr(key.social(userId));
      void batch.execAsPipeline().catch(warn("Could not mark friend lists as changed"));
    },
    async social(userId) {
      const [epoch, count] = await client.mGet([key.socialEpoch, key.social(userId)]);
      return epoch ? `${epoch}.${count ?? 0}` : null;
    },
    async livePeers() {
      const members = await client.sMembers(key.instances);
      return [...(await liveAmong(members))].filter((m) => m !== id).length;
    },
    beat,
    onLost(handler) {
      lost = handler;
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

/** Opened at boot; until then, and after `closePresence`, nothing is recorded and nobody is found. */
export function openPresence(url?: string): PresenceStore {
  if (store) return store;
  store = openPresenceStore({ url });
  store.onLost(lostHandler);
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

export function bumpSocial(userIds: readonly string[]): void {
  store?.bumpSocial(userIds);
}

export function socialVersion(userId: string): Promise<string | null> {
  return opened().social(userId);
}
