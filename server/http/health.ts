import type express from "express";
import type { Request, Response } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { performance } from "node:perf_hooks";
import { register } from "prom-client";
import { pingDatabase } from "../store/db.ts";
import { openRedis, type RedisClient } from "../store/redis.ts";
import { isShuttingDown } from "../game/gameRoom.ts";
import { onEventLoopSlice, stopWatchingEventLoop, watchEventLoop } from "../shared/eventLoop.ts";
import { within } from "../shared/within.ts";
import "../shared/metrics.ts";

const LIVE_PATH = "/health/live";
const READY_PATHS = ["/health", "/health/ready"];
const METRICS_PATH = "/metrics";
/** Asked by a host or a scraper on a schedule: none of them is a request-log line. */
export const PROBE_PATHS: readonly string[] = [LIVE_PATH, ...READY_PATHS, METRICS_PATH];

/** The most one dependency probe may take; a probe still out by then reports `down`. */
const PROBE_DEADLINE_MS = 1_000;
const PROBE_INTERVAL_MS = 1_000;
const MAX_EVENT_LOOP_DELAY_MS = 200;
/** Consecutive one-second slices over the limit before the instance goes unready, and under it before it is ready again. */
const LAG_SLICES_TO_ENTER = 3;
const LAG_SLICES_TO_LEAVE = 3;

type Link = "connected" | "down";

/** Unready only after `enterAfter` bad slices in a row, ready again only after `leaveAfter` good ones. */
export function lagGate({ enterAfter, leaveAfter, maxMs }: { enterAfter: number; leaveAfter: number; maxMs: number }) {
  let lagging = false;
  let streak = 0;
  return {
    observe(p99Ms: number): void {
      const bad = p99Ms > maxMs;
      streak = bad !== lagging ? streak + 1 : 0;
      if (streak >= (lagging ? leaveAfter : enterAfter)) {
        lagging = !lagging;
        streak = 0;
      }
    },
    lagging: () => lagging,
  };
}

const gate = lagGate({ enterAfter: LAG_SLICES_TO_ENTER, leaveAfter: LAG_SLICES_TO_LEAVE, maxMs: MAX_EVENT_LOOP_DELAY_MS });
onEventLoopSlice((p99Ms) => gate.observe(p99Ms));

let booted = false;
let redis: RedisClient | null = null;
let refresher: ReturnType<typeof setInterval> | null = null;
const links: { db: Link; redis: Link; at: number | null } = { db: "down", redis: "down", at: null };

/** One probe in flight per dependency, however often it is asked: a hung one never queues another behind it. */
function singleFlight(ping: () => Promise<unknown>): () => Promise<Link> {
  let pending: Promise<Link> | null = null;
  return () =>
    (pending ??= ping().then(
      (): Link => "connected",
      (): Link => "down"
    ).finally(() => {
      pending = null;
    }));
}

const probeDatabase = singleFlight(pingDatabase);
const probeRedis = singleFlight(async () => {
  if (!redis) throw new Error("the health link to Redis is not open");
  return redis.ping();
});

async function link(probe: () => Promise<Link>): Promise<Link> {
  return (await within(PROBE_DEADLINE_MS, probe())) ?? "down";
}

let refreshing = false;
async function refreshLinks(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const [db, redisLink] = await Promise.all([link(probeDatabase), link(probeRedis)]);
    Object.assign(links, { db, redis: redisLink, at: performance.now() });
  } finally {
    refreshing = false;
  }
}

/** Why this instance should not be sent traffic now, or null when it can serve. */
function notReady(): "booting" | "draining" | "event_loop_lag" | null {
  if (!booted) return "booting";
  if (isShuttingDown()) return "draining";
  if (gate.lagging()) return "event_loop_lag";
  return null;
}

/**
 * Answered from the last finished probe, never by waiting on one: a hung dependency would
 * otherwise slow every instance's answer at once. Postgres and Redis are reported and never decide
 * the status, since both are shared by every instance and one blip would pull the whole fleet.
 */
function ready(_req: Request, res: Response): void {
  const reason = notReady();
  res.status(reason ? 503 : 200).json({
    status: reason ? "unavailable" : "ok",
    ...(reason ? { reason } : {}),
    db: links.db,
    redis: links.redis,
    probedMsAgo: links.at === null ? null : Math.round(performance.now() - links.at),
    uptime: Math.floor(process.uptime()),
  });
}

const digest = (value: string) => createHash("sha256").update(value).digest();

function bearerMatches(header: string | undefined): boolean {
  const token = process.env.METRICS_TOKEN;
  if (!token || !header?.startsWith("Bearer ")) return false;
  return timingSafeEqual(digest(header.slice("Bearer ".length)), digest(token));
}

async function metrics(req: Request, res: Response): Promise<void> {
  if (!bearerMatches(req.header("authorization"))) {
    res.status(401).set("WWW-Authenticate", "Bearer").end();
    return;
  }
  res.type(register.contentType).send(await register.metrics());
}

/** Mounts the probes and `/metrics`; none of them reads the session or waits on the app pool. */
export function mountHealth(app: express.Application): void {
  stopHealth();
  watchEventLoop();
  redis = openRedis("health", { offlineQueue: false });
  redis.on("ready", () => void refreshLinks());
  void refreshLinks();
  refresher = setInterval(() => void refreshLinks(), PROBE_INTERVAL_MS);
  (refresher as unknown as { unref?: () => void }).unref?.();
  app.get(LIVE_PATH, (_req, res) => {
    res.json({ status: "ok" });
  });
  for (const path of READY_PATHS) app.get(path, ready);
  app.get(METRICS_PATH, metrics);
}

/** The app is built: from here on, readiness is the event loop's and the drain's to decide. */
export function markBooted(): void {
  booted = true;
}

/** Stops the background probes and the loop's sampling; the next `mountHealth` starts both again. */
export function stopHealth(): void {
  if (refresher) clearInterval(refresher);
  refresher = null;
  stopWatchingEventLoop();
}
