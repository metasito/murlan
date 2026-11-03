import { Counter, Gauge } from "@prometheus-io/client";
import { pgConnectionHeadroom, poolMeters } from "../store/pool.ts";
import { eventLoopDelayMs } from "./eventLoop.ts";
import { now } from "../http/clock.ts";
import { pendingResultsHeld } from "../game/gameRoom.ts";
import { coalescedWrites } from "../game/roomWriteChain.ts";
import { telemetryRowsDropped } from "./telemetryBatch.ts";

new Gauge({
  name: "event_loop_lag_p99_seconds",
  help: "The event loop's delay at the 99th percentile over the last few seconds",
  collect() {
    this.set(eventLoopDelayMs(99) / 1_000);
  },
});

for (const [state, help] of [
  ["total", "Connections a Postgres pool holds"],
  ["idle", "Connections a Postgres pool holds and nobody is using"],
  ["waiting", "Requests queued for a connection from a Postgres pool"],
] as const) {
  new Gauge({
    name: `pg_pool_${state}`,
    help,
    labelNames: ["pool"],
    collect() {
      this.reset();
      for (const meter of poolMeters()) this.set({ pool: meter.pool }, meter[state]);
    },
  });
}

new Gauge({
  name: "pg_connection_headroom",
  help: "Postgres connections left once every instance seen holds its full share; NaN before the first check",
  collect() {
    this.set(pgConnectionHeadroom() ?? Number.NaN);
  },
});

export const redisReconnects = new Counter({
  name: "redis_reconnects_total",
  help: "Attempts to reconnect a Redis connection, by what the connection is for",
  labelNames: ["use"],
});

export const stateAcksMissed = new Counter({
  name: "state_acks_missed_total",
  help: "game:state sends a socket did not acknowledge in time",
});

export const clusterMessages = new Counter({
  name: "cluster_messages_total",
  help: "Messages this instance put on Redis for other instances, by channel: the adapter's (bar its heartbeats) or an instance inbox",
  labelNames: ["channel"],
});

type Stream = "adapter" | "inbox";
/** Past this with nothing read, the last lag describes nothing current and is reported as 0. */
const STREAM_LAG_STALE_MS = 30_000;
const lastRead = new Map<Stream, { lagMs: number; at: number }>();

new Gauge({
  name: "redis_stream_lag_seconds",
  help: "How long the last entry read from a stream had waited in it; 0 once nothing has been read for 30 s",
  labelNames: ["stream"],
  collect() {
    this.reset();
    for (const [stream, read] of lastRead) {
      this.set({ stream }, now() - read.at > STREAM_LAG_STALE_MS ? 0 : read.lagMs / 1_000);
    }
  },
});

new Gauge({
  name: "redis_stream_read_age_seconds",
  help: "How long since an entry was last read from a stream: a stuck reader grows it, and so does a quiet stream",
  labelNames: ["stream"],
  collect() {
    this.reset();
    for (const [stream, read] of lastRead) this.set({ stream }, Math.max(0, now() - read.at) / 1_000);
  },
});

/** `entryId` is the entry's Redis stream id, whose first part is when Redis appended it. */
export function noteStreamRead(stream: Stream, entryId: string): void {
  const appendedAt = Number(entryId.split("-")[0]);
  if (!Number.isFinite(appendedAt)) return;
  const at = now();
  lastRead.set(stream, { lagMs: Math.max(0, at - appendedAt), at });
}

let storeInfo: Readonly<Record<string, string>> | null = null;

/** The store's last `INFO`, or null once it stops answering; its gauges read NaN until it answers again. */
export function noteStoreInfo(info: Readonly<Record<string, string>> | null): void {
  storeInfo = info;
}

for (const [field, name, help] of [
  ["used_memory", "store_used_memory_bytes", "Memory the key-value store holds"],
  ["maxmemory", "store_maxmemory_bytes", "The key-value store's memory limit; 0 is none"],
  ["evicted_keys", "store_evicted_keys", "Keys the key-value store evicted since it started; any is state lost"],
  ["blocked_clients", "store_blocked_clients", "Connections waiting in a blocking read on the key-value store"],
  ["rejected_connections", "store_rejected_connections", "Connections the key-value store refused since it started"],
] as const) {
  new Gauge({
    name,
    help,
    collect() {
      this.set(Number(storeInfo?.[field] ?? Number.NaN));
    },
  });
}

new Gauge({
  name: "store_info",
  help: "1, labelled with the key-value store's engine, version and eviction policy from its last INFO",
  labelNames: ["engine", "version", "maxmemory_policy"],
  collect() {
    this.reset();
    if (!storeInfo) return;
    const engine = storeInfo.server_name ?? "unknown";
    const version = storeInfo[`${engine}_version`] ?? storeInfo.redis_version ?? "unknown";
    this.set({ engine, version, maxmemory_policy: storeInfo.maxmemory_policy ?? "unknown" }, 1);
  },
});

export const storeMisconfigured = new Counter({
  name: "store_misconfigured_total",
  help: "Checks that found the key-value store unlike deploy/runtime.json's, by what differed",
  labelNames: ["reason"],
});

new Gauge({
  name: "round_results_pending",
  help: "Finished rounds whose result has not yet landed in the database, across the tables this instance owns",
  collect() {
    this.set(pendingResultsHeld().count);
  },
});

new Gauge({
  name: "round_results_pending_age_seconds",
  help: "How long the oldest unlanded round result has waited; 0 when none is pending",
  collect() {
    const { oldestFinishedAt } = pendingResultsHeld();
    this.set(oldestFinishedAt === null ? 0 : Math.max(0, now() - oldestFinishedAt) / 1_000);
  },
});

/** A counter whose total another module already keeps: each scrape adds what grew since the last. */
function mirror(name: string, help: string, total: () => number): void {
  let reported = 0;
  new Counter({
    name,
    help,
    collect() {
      const current = total();
      this.inc(current - reported);
      reported = current;
    },
  });
}

mirror("coalesced_writes_total", "Table snapshots replaced by a newer one before they were written", coalescedWrites);
mirror(
  "telemetry_rows_dropped_total",
  "Diagnostic rows lost: pushed out of a full queue, refused by the database, or for a deleted account",
  telemetryRowsDropped
);
