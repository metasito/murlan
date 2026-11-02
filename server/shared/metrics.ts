import { Counter, Gauge } from "prom-client";
import { pgConnectionHeadroom, poolMeters } from "../store/pool.ts";
import { eventLoopDelayMs } from "./eventLoop.ts";
import { now } from "../http/clock.ts";

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
