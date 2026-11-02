import { logger } from "../shared/logger.ts";
import { instanceId, openRedis, redisKey, type RedisClient } from "./redis.ts";

const CLEAR_IF_MINE = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0";

let client: RedisClient | null = null;

export function tableOwnerKey(roomId: string): string {
  return redisKey(`table-owner:${roomId}`);
}

export function tableOwnerValue(epoch: number, instance: string = instanceId): string {
  return `${instance}:${epoch}`;
}

/** Opened at boot; until then, and after `closeTableOwners`, nothing is recorded. */
export function openTableOwners(url?: string): void {
  if (client?.isOpen) return;
  client = openRedis("owners", { url, offlineQueue: false });
}

export function closeTableOwners(): void {
  client?.destroy();
  client = null;
}

/**
 * Never awaited by a claim and never rejects: losing Redis stops cross-instance routing, not the
 * table. One connection carries both commands, so a clear never overtakes the record it clears.
 */
export function recordTableOwner(roomId: string, epoch: number): void {
  void client
    ?.set(tableOwnerKey(roomId), tableOwnerValue(epoch))
    .catch((err: unknown) => logger.warn({ err, roomId }, "Could not record a table's owner"));
}

/** Clears the record only while it still names this claim: a later owner's stays. */
export function clearTableOwner(roomId: string, epoch: number): void {
  void client
    ?.eval(CLEAR_IF_MINE, { keys: [tableOwnerKey(roomId)], arguments: [tableOwnerValue(epoch)] })
    .catch((err: unknown) => logger.warn({ err, roomId }, "Could not clear a table's owner"));
}
