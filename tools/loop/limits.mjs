/** Plain constants, importable from a CommonJS loader: Playwright's config cannot load queue-loop.mjs. */
export const STALL_MS = 30 * 60_000;

export const CHECK_BASH_TIMEOUT_MS = STALL_MS - 5 * 60_000;

/** How late a tick must arrive to read as the machine having slept, not as a busy event loop. */
export const suspendGapMs = (tick) => Math.max(4 * tick, 2 * 60_000);

/**
 * The part of the gap since the previous tick the machine spent suspended, or 0. A late tick keeps
 * one tick of its own, so a clock whose every tick arrives late still advances, and a watchdog
 * built on it still fires.
 */
export function suspended(prevTickAt, now, tick) {
  const gap = now - prevTickAt;
  return gap > suspendGapMs(tick) ? gap - tick : 0;
}
