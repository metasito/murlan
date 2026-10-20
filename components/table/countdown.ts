// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".
import { useCallback, useEffect, useRef, useState } from "react";

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

/**
 * The chip, the ring and the reconnect mark each count with this: `left` is whole seconds,
 * re-rendered on each whole second of what remains, and `elapsedMs` is what has run so far.
 * `onExpire` fires once per window, never while held. `quiet` drops the per-second render, and
 * `left` and `onExpire` with it, for a reader of `elapsedMs` alone.
 */
export function useCountdown(o: {
  seconds: number;
  resetKey: string;
  running: boolean;
  held?: boolean;
  quiet?: boolean;
  onExpire?: () => void;
  now?: () => number;
}): { left: number; elapsedMs: () => number } {
  const { seconds, resetKey, onExpire, now = Date.now } = o;
  const totalMs = seconds * 1000;
  const counting = o.running && !o.held;
  const ticks = counting && !o.quiet;
  const key = `${resetKey}|${seconds}`;
  // A new window shows full in the same render, so its first frame is never the last one's remainder.
  const [shown, setShown] = useState({ key, left: seconds });
  if (shown.key !== key) setShown({ key, left: seconds });

  const clock = useRef<Countdown | undefined>(undefined);
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  });

  useEffect(() => {
    const step = (running: boolean) => {
      const was = clock.current;
      const at = now();
      clock.current = countdownStep(was, { key, running, now: at, totalMs });
      return { ended: clock.current.expired && was?.key === key && !was.expired, ms: remainingMs(clock.current, at) };
    };
    let id: ReturnType<typeof setTimeout> | undefined;
    const settle = ({ ended, ms }: { ended: boolean; ms: number }) => {
      if (ended) {
        setShown({ key, left: 0 });
        onExpireRef.current?.();
      } else if (ticks && !clock.current?.expired) {
        id = setTimeout(tick, ms % 1000 || 1000);
      }
    };
    const tick = () => {
      const next = step(true);
      setShown({ key, left: Math.ceil(next.ms / 1000) });
      settle(next);
    };
    settle(step(counting));
    return () => {
      clearTimeout(id);
      step(false);
    };
  }, [key, counting, ticks, totalMs, now]);

  const elapsedMs = useCallback(() => {
    const c = clock.current;
    return c && c.key === key ? c.totalMs - remainingMs(c, now()) : 0;
  }, [key, now]);
  return { left: shown.left, elapsedMs };
}
