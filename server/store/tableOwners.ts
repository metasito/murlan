import { logger } from "../shared/logger.ts";
import { instanceId, openRedis, redisKey, type RedisClient } from "./redis.ts";

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

/**
 * Extends the record while it still names this claim, and puts back one the store lost; never a
 * later owner's. Two commands because `IFEQ` and `NX` exclude each other; `NX` cannot overwrite
 * an owner that lands between them. Never rejects.
 */
export async function refreshTableOwner(roomId: string, epoch: number, ttlMs: number): Promise<void> {
  const c = client;
  if (!c) return;
  const key = tableOwnerKey(roomId);
  const value = tableOwnerValue(epoch);
  const expiration = { type: "PX", value: ttlMs } as const;
  try {
    if ((await c.set(key, value, { expiration, condition: "IFEQ", matchValue: value })) === null) {
      await c.set(key, value, { expiration, condition: "NX" });
    }
  } catch (err) {
    logger.warn({ err, roomId }, "Could not refresh a table's owner");
  }
}

/** Clears the record only while it still names this claim: a later owner's stays. Never rejects. */
export async function clearTableOwner(roomId: string, epoch: number): Promise<void> {
  // node-redis types Redis's DELEX, not Valkey's DELIFEQ.
  await client
    ?.sendCommand(["DELIFEQ", tableOwnerKey(roomId), tableOwnerValue(epoch)])
    .catch((err: unknown) => logger.warn({ err, roomId }, "Could not clear a table's owner"));
}
