import { logger } from "../shared/logger.ts";
import { instanceId, openRedis, redisKey, type RedisClient } from "./redis.ts";

const CLEAR_IF_MINE = "if redis.call('HGET', KEYS[1], 'socket') == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0";

let client: RedisClient | null = null;
/** This instance's sockets, so an entry Redis lost while it was away is put back. */
const mine = new Map<string, string>();

export function presenceKey(userId: string): string {
  return redisKey(`presence:${userId}`);
}

function write(userId: string, socketId: string): void {
  void client
    ?.hSet(presenceKey(userId), { instance: instanceId, socket: socketId })
    .catch((err: unknown) => logger.warn({ err, userId }, "Could not record where an account is connected"));
}

/** Opened at boot; until then, and after `closePresence`, nothing is recorded and nobody is found. */
export function openPresence(url?: string): void {
  if (client?.isOpen) return;
  const opened = openRedis("presence", { url, offlineQueue: false });
  opened.on("ready", () => {
    for (const [userId, socketId] of mine) write(userId, socketId);
  });
  client = opened;
}

export function closePresence(): void {
  client?.destroy();
  client = null;
  mine.clear();
}

/** The newest socket wins: an account holds one socket (`server/CLAUDE.md`). Never rejects. */
export function recordPresence(userId: string, socketId: string): void {
  mine.set(userId, socketId);
  write(userId, socketId);
}

/** Only while the entry still names this socket: a replacement's, written since, stays. Never rejects. */
export function forgetPresence(userId: string, socketId: string): void {
  if (mine.get(userId) === socketId) mine.delete(userId);
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
