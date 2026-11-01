import type express from "express";
import type { Request, Response } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { register } from "prom-client";
import { pingDatabase } from "../store/db.ts";
import { openRedis, type RedisClient } from "../store/redis.ts";
import { isShuttingDown } from "../game/gameRoom.ts";
import { eventLoopDelayMs, watchEventLoop } from "../shared/eventLoop.ts";
import { within } from "../shared/within.ts";
import "../shared/metrics.ts";

const LIVE_PATH = "/health/live";
const READY_PATHS = ["/health", "/health/ready"];
const METRICS_PATH = "/metrics";
/** Asked by a host or a scraper on a schedule: none of them is a request-log line. */
export const PROBE_PATHS: readonly string[] = [LIVE_PATH, ...READY_PATHS, METRICS_PATH];

const PROBE_DEADLINE_MS = 1_000;
const MAX_EVENT_LOOP_DELAY_MS = 200;

type Link = "connected" | "down";

let booted = false;
let redis: RedisClient | null = null;

/** One probe in flight per dependency, however many probes ask: a burst never queues on its pool. */
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

/** Why this instance should not be sent traffic now, or null when it can serve. */
function notReady(): "booting" | "draining" | "event_loop_lag" | null {
  if (!booted) return "booting";
  if (isShuttingDown()) return "draining";
  if (eventLoopDelayMs(99) > MAX_EVENT_LOOP_DELAY_MS) return "event_loop_lag";
  return null;
}

/**
 * Postgres and Redis are reported and never decide the status: both are shared by every
 * instance, so one blip failing each instance's probe would pull the whole fleet at once.
 */
async function ready(_req: Request, res: Response): Promise<void> {
  const reason = notReady();
  const [db, redisLink] = await Promise.all([link(probeDatabase), link(probeRedis)]);
  res.status(reason ? 503 : 200).json({
    status: reason ? "unavailable" : "ok",
    ...(reason ? { reason } : {}),
    db,
    redis: redisLink,
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
  watchEventLoop();
  redis = openRedis("health", { offlineQueue: false });
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
