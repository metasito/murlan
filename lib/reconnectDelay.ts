const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30_000;

/**
 * Full jitter: a server restart drops every client at once, and a fixed
 * schedule brings them all back on the same tick.
 */
export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  return Math.floor(random() * Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS));
}
