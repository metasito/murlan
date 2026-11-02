import { logger } from "../shared/logger.ts";
import { instanceId, openRedis, redisKey, type RedisClient } from "./redis.ts";

const CLEAR_IF_MINE = "if redis.call('HGET', KEYS[1], 'socket') == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0";
/** Redis's own clock in microseconds, so every stamp comes from one clock and no instance's skew counts. */
const NOW = "local t = redis.call('TIME') local at = t[1] .. string.format('%06d', tonumber(t[2]))";

/** A connection takes the entry outright: the newest connect always wins. Returns its stamp. */
const CONNECT = `${NOW}
redis.call('HSET', KEYS[1], 'instance', ARGV[1], 'socket', ARGV[2], 'at', at)
return at`;

/**
 * Puts back an entry this instance holds unless Redis holds a newer one: ARGV[3] is the stamp its
 * connect was given, or, for a connect that never reached Redis, the newest stamp this instance
 * has been given, which that connect followed. Stamps survive Redis losing its data, not a
 * failover to a replica whose clock is behind.
 */
const REFILL = `local held = redis.call('HGET', KEYS[1], 'at')
if held and tonumber(held) >= tonumber(ARGV[3]) then return 0 end
${NOW}
if ARGV[3] ~= '0' then at = ARGV[3] end
return redis.call('HSET', KEYS[1], 'instance', ARGV[1], 'socket', ARGV[2], 'at', at)`;

let client: RedisClient | null = null;
/** This instance's sockets, each with the stamp Redis gave its connect once one has. */
const mine = new Map<string, { socketId: string; at?: string }>();
/** The newest stamp Redis has given this instance; "0" before the first. */
let newestStamp = "0";

export function presenceKey(userId: string): string {
  return redisKey(`presence:${userId}`);
}

const writeFailed = (userId: string) => (err: unknown) =>
  logger.warn({ err, userId }, "Could not record where an account is connected");

/** Opened at boot; until then, and after `closePresence`, nothing is recorded and nobody is found. */
export function openPresence(url?: string): void {
  if (client?.isOpen) return;
  const opened = openRedis("presence", { url, offlineQueue: false });
  client = opened;
  opened.on("ready", () => {
    for (const [userId, { socketId, at }] of mine) {
      void opened
        .eval(REFILL, { keys: [presenceKey(userId)], arguments: [instanceId, socketId, at ?? newestStamp] })
        .catch(writeFailed(userId));
    }
  });
}

export function closePresence(): void {
  client?.destroy();
  client = null;
  mine.clear();
  newestStamp = "0";
}

/** The newest socket wins: an account holds one socket (`server/CLAUDE.md`). Never rejects. */
export function recordPresence(userId: string, socketId: string): void {
  const held = { socketId } as { socketId: string; at?: string };
  mine.set(userId, held);
  void client
    ?.eval(CONNECT, { keys: [presenceKey(userId)], arguments: [instanceId, socketId] })
    .then((at) => {
      held.at = String(at);
      if (BigInt(held.at) > BigInt(newestStamp)) newestStamp = held.at;
    })
    .catch(writeFailed(userId));
}

/** Only while the entry still names this socket: a replacement's, written since, stays. Never rejects. */
export function forgetPresence(userId: string, socketId: string): void {
  if (mine.get(userId)?.socketId === socketId) mine.delete(userId);
  void client
    ?.eval(CLEAR_IF_MINE, { keys: [presenceKey(userId)], arguments: [socketId] })
    .catch((err: unknown) => logger.warn({ err, userId }, "Could not clear where an account was connected"));
}

/**
 * The instance each account is connected to, in one pipelined read; an account with no entry is
 * offline and absent from the map. Rejects while Redis is unreachable.
 */
export async function instancesOf(userIds: readonly string[]): Promise<Map<string, string>> {
  const c = client;
  if (!c) throw new Error("presence is not open");
  const found = await Promise.all(userIds.map((id) => c.hGet(presenceKey(id), "instance")));
  const where = new Map<string, string>();
  userIds.forEach((id, i) => {
    const instance = found[i];
    if (instance) where.set(id, instance);
  });
  return where;
}
