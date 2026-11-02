import { logger } from "../shared/logger.ts";
import { instanceId, openRedis, redisKey, type RedisClient } from "./redis.ts";

const CLEAR_IF_MINE = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0";
const REFRESH_IF_MINE =
  "local v = redis.call('GET', KEYS[1]) " +
  "if v == false then return redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2]) end " +
  "if v == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) end return 0";

let client: RedisClient | null = null;

export function tableOwnerKey(roomId: string): string {
  return redisKey(`table-owner:${roomId}`);
}

export function tableOwnerValue(epoch: number, instance: string = instanceId): string {
  return `${instance}:${epoch}`;
}

/** The instance a table's owner record names; null with no record. Rejects while Redis is unreachable. */
export async function tableOwnerOf(roomId: string): Promise<string | null> {
  const c = client;
  if (!c) throw new Error("table owners are not open");
  const value = await c.get(tableOwnerKey(roomId));
  return value ? value.slice(0, value.lastIndexOf(":")) : null;
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
 * table. One connection carries every command, so a clear never overtakes the record it clears.
 */
export function recordTableOwner(roomId: string, epoch: number, ttlMs: number): void {
  void client
    ?.set(tableOwnerKey(roomId), tableOwnerValue(epoch), { expiration: { type: "PX", value: ttlMs } })
    .catch((err: unknown) => logger.warn({ err, roomId }, "Could not record a table's owner"));
}

/** Extends the record while it still names this claim, and puts back one Redis lost; never a later owner's. */
export function refreshTableOwner(roomId: string, epoch: number, ttlMs: number): void {
  void client
    ?.eval(REFRESH_IF_MINE, { keys: [tableOwnerKey(roomId)], arguments: [tableOwnerValue(epoch), String(ttlMs)] })
    .catch((err: unknown) => logger.warn({ err, roomId }, "Could not refresh a table's owner"));
}

/** Clears the record only while it still names this claim: a later owner's stays. Never rejects. */
export async function clearTableOwner(roomId: string, epoch: number): Promise<void> {
  await client
    ?.eval(CLEAR_IF_MINE, { keys: [tableOwnerKey(roomId)], arguments: [tableOwnerValue(epoch)] })
    .catch((err: unknown) => logger.warn({ err, roomId }, "Could not clear a table's owner"));
}
