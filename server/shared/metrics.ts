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

const streamLag = new Gauge({
  name: "redis_stream_lag_seconds",
  help: "How long the last entry read from a stream had waited in it",
  labelNames: ["stream"],
});

/** `entryId` is the entry's Redis stream id, whose first part is when Redis appended it. */
export function noteStreamRead(stream: "adapter" | "inbox", entryId: string): void {
  const appendedAt = Number(entryId.split("-")[0]);
  if (Number.isFinite(appendedAt)) streamLag.set({ stream }, Math.max(0, now() - appendedAt) / 1_000);
}
