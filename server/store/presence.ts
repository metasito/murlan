import { logger } from "../shared/logger.ts";
import { instanceId, openRedis, redisKey, type RedisClient } from "./redis.ts";

const CLEAR_IF_MINE = "if redis.call('HGET', KEYS[1], 'socket') == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0";
/**
 * Writes `{ instance, socket, at }` unless the entry already names a connection at least as new:
 * the newest connection wins whichever instance reaches Redis first. `at` is the socket's
 * handshake time; an entry with none is older than any.
 */
const WRITE_IF_NEWER = `local at = tonumber(redis.call('HGET', KEYS[1], 'at'))
if at and at >= tonumber(ARGV[3]) and redis.call('HGET', KEYS[1], 'socket') ~= ARGV[2] then return 0 end
return redis.call('HSET', KEYS[1], 'instance', ARGV[1], 'socket', ARGV[2], 'at', ARGV[3])`;

let client: RedisClient | null = null;
/** This instance's sockets and when each connected, so an entry Redis lost while it was away is put back. */
const mine = new Map<string, { socketId: string; at: number }>();

export function presenceKey(userId: string): string {
  return redisKey(`presence:${userId}`);
}

function write(userId: string, socketId: string, at: number): void {
  void client
    ?.eval(WRITE_IF_NEWER, { keys: [presenceKey(userId)], arguments: [instanceId, socketId, String(at)] })
    .catch((err: unknown) => logger.warn({ err, userId }, "Could not record where an account is connected"));
}

/** Opened at boot; until then, and after `closePresence`, nothing is recorded and nobody is found. */
export function openPresence(url?: string): void {
  if (client?.isOpen) return;
  const opened = openRedis("presence", { url, offlineQueue: false });
  client = opened;
  opened.on("ready", () => {
    for (const [userId, { socketId, at }] of mine) write(userId, socketId, at);
  });
}

export function closePresence(): void {
  client?.destroy();
  client = null;
  mine.clear();
}

/** `connectedAt` is the socket's handshake time, which decides between two connections. Never rejects. */
export function recordPresence(userId: string, socketId: string, connectedAt: number): void {
  mine.set(userId, { socketId, at: connectedAt });
  write(userId, socketId, connectedAt);
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
