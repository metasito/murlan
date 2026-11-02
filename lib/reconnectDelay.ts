const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 5000;

/**
 * Full jitter: a server restart drops every client at once, and a fixed
 * schedule brings them all back on the same tick.
 */
export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  return Math.floor(random() * Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS));
}

/** How far apart a draining server spreads its sockets' first reconnects (`server:draining`). */
export const DRAINING_SPREAD_MS = 10_000;

/** A reconnect waits out a draining server's notice too, whichever ends later, and never past the spread. */
export function reconnectWaitMs(attempt: number, drainingForMs: number, random: () => number = Math.random): number {
  return Math.max(reconnectDelayMs(attempt, random), Math.min(drainingForMs, DRAINING_SPREAD_MS));
}
