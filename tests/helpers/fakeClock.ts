import { realClock, type Clock } from "../../server/http/clock.ts";

export interface FakeClock extends Clock {
  /** Moves time forward, firing every timer due on the way in deadline order. */
  advance(ms: number): void;
}

export function fakeClock(startMs = 1_000_000): FakeClock {
  let now = startMs;
  let nextId = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = ++nextId;
      due.set(id, { at: now + ms, fn });
      return id;
    },
    // A timer armed before this clock was installed is still the real clock's to clear.
    clearTimeout(handle) {
      if (typeof handle === "number") due.delete(handle);
      else realClock.clearTimeout(handle);
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...due].filter(([, t]) => t.at <= end).sort(([, a], [, b]) => a.at - b.at)[0];
        if (!next) break;
        due.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = end;
    },
  };
}

export interface SkewedClock extends Clock {
  /** Moves `now()` forward without waiting; armed timers keep their real schedule. */
  skip(ms: number): void;
}

export function skewedClock(): SkewedClock {
  let skew = 0;
  return {
    ...realClock,
    now: () => Date.now() + skew,
    skip(ms) {
      skew += ms;
    },
  };
}
