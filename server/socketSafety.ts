import type { Socket } from "socket.io";
import { z } from "zod";
import { logger } from "./logger.ts";

/**
 * Boundary wrapper for socket events: validate the payload, rate limit the
 * caller, and make sure a throwing handler degrades to an error emitted to
 * that one socket instead of an unhandled rejection that kills the process.
 */

interface RateWindow {
  count: number;
  resetAt: number;
}

export interface EventOptions {
  /** Max invocations per window for this user. Omit for no limit. */
  limit?: number;
  /** Window length in ms (default 10s). */
  windowMs?: number;
}

/**
 * userId -> event -> window. Deliberately keyed by *user*, not by socket:
 * nothing stops one session opening fifty websockets, and per-socket buckets
 * gave that session fifty times every limit (room:create, friend:invite, the
 * lot). The account is the thing that actually needs limiting.
 */
const userBuckets = new Map<string, Map<string, RateWindow>>();

/**
 * Expired windows are dropped on a lazy sweep rather than when a socket
 * disconnects. Releasing on disconnect would hand back a fresh allowance to
 * anyone willing to reconnect, while an unswept map would grow with every
 * account that ever connected.
 */
const SWEEP_INTERVAL_MS = 60_000;
let lastSweepAt = 0;

function sweepExpired(now: number): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  for (const [userId, windows] of userBuckets) {
    for (const [key, window] of windows) {
      if (window.resetAt <= now) windows.delete(key);
    }
    if (windows.size === 0) userBuckets.delete(userId);
  }
}

function bucketsFor(socket: Socket, now: number): Map<string, RateWindow> {
  const userId = socket.data?.userId as string | undefined;
  if (!userId) {
    // No authenticated identity to key on (should be unreachable — the
    // handshake middleware rejects those connections). Fall back to
    // per-socket state so the limiter still applies rather than opening up.
    return socket.data.rateBuckets ?? (socket.data.rateBuckets = new Map());
  }
  sweepExpired(now);
  let windows = userBuckets.get(userId);
  if (!windows) {
    windows = new Map();
    userBuckets.set(userId, windows);
  }
  return windows;
}

/** Test-only: drops all limiter state so cases cannot bleed into each other. */
export function __resetRateLimits(): void {
  userBuckets.clear();
  lastSweepAt = 0;
}

function errorEventFor(event: string): string {
  const ns = event.split(":")[0];
  return ns === "room" || ns === "game" || ns === "friend"
    ? `${ns}:error`
    : "socket:error";
}

/**
 * Per-*user* fixed-window limiter: every socket a given account has open
 * shares one bucket, so opening more connections buys no extra allowance.
 */
export function allowSocketAction(
  socket: Socket,
  key: string,
  limit: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const buckets = bucketsFor(socket, now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

export function onEvent<S extends z.ZodTypeAny>(
  socket: Socket,
  event: string,
  schema: S,
  handler: (payload: z.infer<S>) => void | Promise<void>,
  options: EventOptions = {}
): void {
  socket.on(event, (rawPayload: unknown) => {
    void (async () => {
      try {
        if (
          options.limit !== undefined &&
          !allowSocketAction(socket, event, options.limit, options.windowMs ?? 10_000)
        ) {
          socket.emit(errorEventFor(event), {
            message: "Troppe richieste, rallenta.",
          });
          return;
        }

        const parsed = schema.safeParse(rawPayload);
        if (!parsed.success) {
          logger.warn(
            { event, userId: socket.data?.userId },
            "Rejected malformed socket payload"
          );
          socket.emit(errorEventFor(event), { message: "Dati non validi" });
          return;
        }

        await handler(parsed.data);
      } catch (err) {
        logger.error(
          { err, event, userId: socket.data?.userId },
          "Socket handler threw — contained"
        );
        socket.emit(errorEventFor(event), { message: "Server error" });
      }
    })();
  });
}

/**
 * Process-level last resort, for anything escaping `onEvent` and the timer
 * containment. Exits non-zero for the supervisor to restart: `game:rejoin`
 * rehydrates from `active_games`, so a restart costs a reconnect, while a
 * server carrying on in an unknown state can wedge a table for good.
 *
 * Installed by `server/index.ts`, which owns the process — `createApp()` must
 * not, since the integration harness boots it in-process.
 */
export function installProcessGuards(): void {
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "Unhandled promise rejection — contained");
  });
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception — exiting");
    // Synchronous for pino's default destination, so the fatal line is on the
    // wire before the exit. Exiting is unconditional either way — a guard that
    // could be skipped by a transport that never flushed would be no guard.
    logger.flush?.();
    process.exit(1);
  });
}
