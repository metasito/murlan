/** Plain constants, importable from a CommonJS loader: Playwright's config cannot load queue-loop.mjs. */
export const STALL_MS = 30 * 60_000;

export const CHECK_BASH_TIMEOUT_MS = STALL_MS - 5 * 60_000;

/** How late a tick must arrive to read as the machine having slept, not as a busy event loop. */
const suspendGapMs = (tick) => Math.max(4 * tick, 2 * 60_000);

/**
 * A clock for something that wakes every `tick`: each `lap()` answers how much of the time since
 * the last lap the machine spent suspended, or 0. A late lap keeps one tick of its own, so a clock
 * whose every tick arrives late still advances, and a watchdog built on it still fires.
 */
export function sleepClock(tick) {
  let at = Date.now();
  return {
    lap() {
      const now = Date.now();
      const gap = now - at;
      at = now;
      return gap > suspendGapMs(tick) ? gap - tick : 0;
    },
  };
}
