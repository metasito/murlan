// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

/** One window counting down: `since` is when it last started running, null while held or ended. */
export interface Countdown {
  key: string;
  totalMs: number;
  ranMs: number;
  since: number | null;
  expired: boolean;
}

/** The window after `i`: a new key starts it full, a hold freezes what has run, and it ends once. */
export function countdownStep(
  c: Countdown | undefined,
  i: { key: string; running: boolean; now: number; totalMs: number }
): Countdown {
  if (!c || c.key !== i.key || c.totalMs !== i.totalMs) {
    return { key: i.key, totalMs: i.totalMs, ranMs: 0, since: i.running ? i.now : null, expired: i.totalMs <= 0 };
  }
  if (c.expired) return c;
  const ranMs = c.ranMs + (c.since === null ? 0 : i.now - c.since);
  if (!i.running) return c.since === null ? c : { ...c, ranMs, since: null };
  if (ranMs >= c.totalMs) return { ...c, ranMs: c.totalMs, since: null, expired: true };
  return c.since === null ? { ...c, since: i.now } : c;
}

export function remainingMs(c: Countdown, now: number): number {
  return Math.max(0, c.totalMs - c.ranMs - (c.since === null ? 0 : now - c.since));
}

/** A window as its readers see it: a new identity on each start, hold and resume, none in between. */
export interface CountdownClock {
  key: string;
  seconds: number;
  counting: boolean;
  elapsedMs: () => number;
}

/**
 * The one owner of a window: the chip and the ring read the clock it returns and only it steps the
 * window, so their key, hold and expiry cannot disagree. It never re-renders its owner by itself.
 * `onExpire` fires once per window, never while held.
 */
export function useCountdown(o: {
  seconds: number;
  resetKey: string;
  running: boolean;
  held?: boolean;
  onExpire?: () => void;
  now?: () => number;
}): CountdownClock {
  const { seconds, resetKey, onExpire, now = Date.now } = o;
  const totalMs = seconds * 1000;
  const counting = o.running && !o.held;
  const expires = onExpire !== undefined;
  const key = `${resetKey}|${seconds}`;
  const state = useRef<Countdown | undefined>(undefined);
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  });

  // A layout effect, so the window has stepped before any reader's passive effect asks it.
  useLayoutEffect(() => {
    const step = (running: boolean) => {
      const was = state.current;
      const at = now();
      state.current = countdownStep(was, { key, running, now: at, totalMs });
      return { ended: state.current.expired && was?.key === key && !was.expired, ms: remainingMs(state.current, at) };
    };
    let id: ReturnType<typeof setTimeout> | undefined;
    const settle = ({ ended, ms }: { ended: boolean; ms: number }) => {
      if (ended) onExpireRef.current?.();
      else if (counting && expires && !state.current?.expired) id = setTimeout(() => settle(step(true)), ms);
    };
    settle(step(counting));
    return () => {
      clearTimeout(id);
      step(false);
    };
  }, [key, counting, expires, totalMs, now]);

  const elapsedMs = useCallback(() => {
    const c = state.current;
    return c && c.key === key ? c.totalMs - remainingMs(c, now()) : 0;
  }, [key, now]);
  return useMemo(() => ({ key, seconds, counting, elapsedMs }), [key, seconds, counting, elapsedMs]);
}

/** Whole seconds left in `clock`, re-rendering only its reader on each whole second of what remains, and only while `on`. */
export function useSecondsLeft(clock: CountdownClock, on = true): number {
  // A new window shows full in the same render, so its first frame is never the last one's remainder.
  const [shown, setShown] = useState({ key: clock.key, left: clock.seconds });
  if (shown.key !== clock.key) setShown({ key: clock.key, left: clock.seconds });
  useEffect(() => {
    let id: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const ms = Math.max(0, clock.seconds * 1000 - clock.elapsedMs());
      const left = Math.ceil(ms / 1000);
      setShown((s) => (s.key === clock.key && s.left === left ? s : { key: clock.key, left }));
      if (on && clock.counting && ms > 0) id = setTimeout(tick, ms % 1000 || 1000);
    };
    tick();
    return () => clearTimeout(id);
  }, [clock, on]);
  return shown.left;
}
