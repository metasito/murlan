import runtime from "../../deploy/runtime.json" with { type: "json" };
import { logger } from "../shared/logger.ts";
import { storeMisconfigured } from "../shared/metrics.ts";

/** Read from `INFO`, never `CONFIG GET`, which a managed host may deny. */
export const STORE_INFO_COMMAND = ["INFO", "server", "clients", "memory", "stats"];

export type StoreInfo = Record<string, string>;

export function parseInfo(reply: string): StoreInfo {
  const info: StoreInfo = {};
  for (const line of reply.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon > 0 && !line.startsWith("#")) info[line.slice(0, colon)] = line.slice(colon + 1);
  }
  return info;
}

type Misfit = { reason: "engine" | "major" | "maxmemory_policy"; found: string | undefined; expected: string | number };

/** How the store differs from `deploy/runtime.json`'s. `redis_version` reads 7.2.4 on Valkey, so it names no engine. */
function misfits(info: StoreInfo): Misfit[] {
  const { engine, major, maxmemoryPolicy } = runtime.keyValue;
  const found: Misfit[] = [];
  if (info.server_name !== engine) found.push({ reason: "engine", found: info.server_name, expected: engine });
  else if (!(Number.parseInt(info[`${engine}_version`] ?? "", 10) >= major)) {
    found.push({ reason: "major", found: info[`${engine}_version`], expected: major });
  }
  if (info.maxmemory_policy !== maxmemoryPolicy) {
    found.push({ reason: "maxmemory_policy", found: info.maxmemory_policy, expected: maxmemoryPolicy });
  }
  return found;
}

/** Logs and counts each way the store is not the one this server is built for; never stops it. */
export function checkStore(info: StoreInfo): void {
  for (const { reason, found, expected } of misfits(info)) {
    storeMisconfigured.inc({ reason });
    logger.error({ reason, found, expected }, "The key-value store is not the one deploy/runtime.json names");
  }
}
