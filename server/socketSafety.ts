import type { Socket } from "socket.io";
import { z } from "zod";
import { logger } from "./logger.ts";
import { payload } from "./payload.ts";

/**
 * Boundary wrapper for socket events: validate the payload, rate limit the
 * caller, and make sure a throwing handler degrades to an error emitted to
 * that one socket instead of an unhandled rejection that kills the process.
 */

interface RateWindow {
  count: number;
  resetAt: number;
  /**
   * Whether this window's refusal has already been recorded. The limiter's
   * whole point is that excess is cheap, and a log write per rejected packet
   * would hand a flooder a disk-filling primitive for free.
   */
  refusalLogged?: boolean;
}

/**
 * The one line every refusal is recorded on, wherever it was decided.
 *
 * Only ever a *parsed* payload reaches `extra`: the raw packet is
 * attacker-shaped and unbounded. Room codes are the one credential a payload
 * carries, and `server/logger.ts` redacts them — `tests/logRedaction.test.ts`
 * pins that a new one cannot be added without being redacted too.
 */
function logRefusal(
  event: string,
  socket: Socket,
  code: string,
  extra: Record<string, unknown> = {}
): void {
  logger.warn({ event, userId: socket.data?.userId, code, ...extra }, "Socket event refused");
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

export function errorEventFor(event: string): string {
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
  if (bucket.count >= limit) {
    if (!bucket.refusalLogged) {
      bucket.refusalLogged = true;
      logRefusal(key, socket, "RATE_LIMITED");
    }
    return false;
  }
  bucket.count += 1;
  return true;
}

/**
 * What an intent's acknowledgement carries back.
 *
 * `ok: false` is an answer, not a silence: a client that retries when nothing
 * comes back must be able to tell "the server never heard me" from "the server
 * heard me and said no", or it retries a thing that will never work.
 */
export interface EventOutcome {
  ok: boolean;
  code?: string;
}

/**
 * A handler that returns nothing did the thing. One that turned the intent
 * away returns why.
 *
 * Returning is what makes the refusal reachable: a handler that emitted
 * `game:error` and returned, or that returned in silence because the socket
 * held no room, is indistinguishable from success to the wrapper — and
 * answering `ok: true` there is worse than the silence acknowledgement
 * replaced, because the client stops retrying and tells the player it worked.
 */
type EventResult = void | EventOutcome;

export function onEvent<S extends z.ZodTypeAny>(
  socket: Socket,
  event: string,
  schema: S,
  handler: (payload: z.infer<S>) => EventResult | Promise<EventResult>,
  options: EventOptions = {}
): void {
  socket.on(event, (...args: unknown[]) => {
    // Socket.IO appends the client's acknowledgement callback as the last
    // argument when there is one, so the payload is not always args[0] alone.
    const ack = typeof args[args.length - 1] === "function"
      ? (args.pop() as (reply: EventOutcome) => void)
      : undefined;
    const rawPayload = args[0];
    // Exactly once, whatever the handler does. A client that retries on
    // silence must not be answered twice, and must not be left waiting
    // because a handler threw before saying anything.
    let answered = false;
    const answer = (reply: EventOutcome) => {
      if (answered) return;
      answered = true;
      ack?.(reply);
    };

    void (async () => {
      try {
        if (
          options.limit !== undefined &&
          // Records its own refusal, once per window rather than per packet.
          !allowSocketAction(socket, event, options.limit, options.windowMs ?? 10_000)
        ) {
          socket.emit(errorEventFor(event), payload("RATE_LIMITED"));
          answer({ ok: false, code: "RATE_LIMITED" });
          return;
        }

        const parsed = schema.safeParse(rawPayload);
        if (!parsed.success) {
          logRefusal(event, socket, "INVALID_PAYLOAD");
          socket.emit(errorEventFor(event), payload("INVALID_PAYLOAD"));
          answer({ ok: false, code: "INVALID_PAYLOAD" });
          return;
        }

        const outcome = (await handler(parsed.data)) ?? { ok: true };
        if (!outcome.ok) {
          logRefusal(event, socket, outcome.code ?? "UNSPECIFIED", { payload: parsed.data });
        }
        answer(outcome);
      } catch (err) {
        logger.error(
          { err, event, userId: socket.data?.userId, code: "SERVER_ERROR" },
          "Socket handler threw — contained"
        );
        socket.emit(errorEventFor(event), payload("SERVER_ERROR"));
        answer({ ok: false, code: "SERVER_ERROR" });
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
