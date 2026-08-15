import type { Socket } from "socket.io";
import { z } from "zod";
import { logger } from "./logger";

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
  /** Max invocations per window for this socket. Omit for no limit. */
  limit?: number;
  /** Window length in ms (default 10s). */
  windowMs?: number;
}

function errorEventFor(event: string): string {
  const ns = event.split(":")[0];
  return ns === "room" || ns === "game" || ns === "friend"
    ? `${ns}:error`
    : "socket:error";
}

/**
 * Per-socket fixed-window limiter. State lives on `socket.data`, so it is
 * collected with the socket and cannot leak.
 */
export function allowSocketAction(
  socket: Socket,
  key: string,
  limit: number,
  windowMs: number
): boolean {
  const buckets: Map<string, RateWindow> =
    socket.data.rateBuckets ?? (socket.data.rateBuckets = new Map());
  const now = Date.now();
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
        socket.emit(errorEventFor(event), { message: "Errore del server" });
      }
    })();
  });
}

/**
 * Last line of defence. Anything that escapes `onEvent` (a stray timer, a
 * library callback) must not stop a server that is holding live games in
 * memory for other players.
 */
export function installProcessGuards(): void {
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "Unhandled promise rejection — contained");
  });
  process.on("uncaughtException", (err) => {
    logger.error({ err }, "Uncaught exception — contained");
  });
}
