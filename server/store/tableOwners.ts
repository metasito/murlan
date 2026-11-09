import { logger } from "../shared/logger.ts";
import { settleInFlight, track } from "../shared/inFlight.ts";
import { instanceId, openRedis, redisKey, type RedisClient } from "./redis.ts";

let client: RedisClient | null = null;
/** The refreshes in flight per record, each flagged by a clear of that record sent while it runs. */
const refreshing = new Map<string, Set<{ cleared: boolean }>>();

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

const CLOSE_SETTLE_MS = 1_000;

/** Waits for the records and clears already started, which `destroy()` would cut off. */
export async function closeTableOwners(): Promise<void> {
  await settleInFlight(CLOSE_SETTLE_MS);
  client?.destroy();
  client = null;
}

/**
 * Never awaited by a claim and never rejects: losing Redis stops cross-instance routing, not the
 * table. One connection carries every command, so a clear never overtakes the record it clears.
 */
export function recordTableOwner(roomId: string, epoch: number, ttlMs: number): void {
  const c = client;
  if (!c) return;
  void track(
    c
      .set(tableOwnerKey(roomId), tableOwnerValue(epoch), { expiration: { type: "PX", value: ttlMs } })
      .catch((err: unknown) => logger.warn({ err, roomId }, "Could not record a table's owner"))
  );
}

/**
 * Extends the record while it still names this claim, and puts back one the store lost; never a
 * later owner's, nor one this claim cleared meanwhile. Two commands because `IFEQ` and `NX`
 * exclude each other; `NX` cannot overwrite an owner that lands between them. Never rejects.
 */
export async function refreshTableOwner(roomId: string, epoch: number, ttlMs: number): Promise<void> {
  const c = client;
  if (!c) return;
  const key = tableOwnerKey(roomId);
  const value = tableOwnerValue(epoch);
  const expiration = { type: "PX", value: ttlMs } as const;
  const record = `${key}\n${value}`;
  const run = { cleared: false };
  const runs = refreshing.get(record) ?? new Set();
  refreshing.set(record, runs.add(run));
  try {
    if ((await c.set(key, value, { expiration, condition: "IFEQ", matchValue: value })) === null && !run.cleared) {
      await c.set(key, value, { expiration, condition: "NX" });
    }
  } catch (err) {
    logger.warn({ err, roomId }, "Could not refresh a table's owner");
  } finally {
    runs.delete(run);
    if (runs.size === 0 && refreshing.get(record) === runs) refreshing.delete(record);
  }
}

/** Clears the record only while it still names this claim: a later owner's stays. Never rejects. */
export async function clearTableOwner(roomId: string, epoch: number): Promise<void> {
  for (const run of refreshing.get(`${tableOwnerKey(roomId)}\n${tableOwnerValue(epoch)}`) ?? []) run.cleared = true;
  // node-redis types Redis's DELEX, not Valkey's DELIFEQ.
  await client
    ?.sendCommand(["DELIFEQ", tableOwnerKey(roomId), tableOwnerValue(epoch)])
    .catch((err: unknown) => logger.warn({ err, roomId }, "Could not clear a table's owner"));
}
