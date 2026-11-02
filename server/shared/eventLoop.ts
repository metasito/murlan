import { createHistogram, performance, type RecordableHistogram } from "node:perf_hooks";

const SAMPLE_MS = 10;
const SLICE_MS = 1_000;
/** The window a percentile is read over: this many slices, plus the one filling now. */
const SLICES = 5;

let current: RecordableHistogram | null = null;
let slices: RecordableHistogram[] = [];
let startedAt = 0;
let timers: ReturnType<typeof setInterval>[] = [];
const sliceListeners = new Set<(p99Ms: number) => void>();

function unref(timer: ReturnType<typeof setInterval>): ReturnType<typeof setInterval> {
  (timer as unknown as { unref?: () => void }).unref?.();
  return timer;
}

/**
 * Starts sampling the loop's delay on a timer of its own, never at the moment someone asks: a
 * handler that blocks the loop is measured once it lets go, whatever it was doing.
 */
export function watchEventLoop(): void {
  if (current) return;
  let filling = createHistogram();
  current = filling;
  startedAt = performance.now();
  let last = startedAt;
  const sample = setInterval(() => {
    const now = performance.now();
    filling.record(Math.max(1, Math.round((now - last - SAMPLE_MS) * 1e6)));
    last = now;
  }, SAMPLE_MS);
  const rotate = setInterval(() => {
    const done = filling;
    slices = [...slices, done].slice(-SLICES);
    filling = createHistogram();
    current = filling;
    const p99Ms = done.count === 0 ? 0 : done.percentile(99) / 1e6;
    for (const listener of sliceListeners) listener(p99Ms);
  }, SLICE_MS);
  timers = [unref(sample), unref(rotate)];
}

export function stopWatchingEventLoop(): void {
  for (const timer of timers) clearInterval(timer);
  timers = [];
  current = null;
  slices = [];
}

/** Called with each second's p99 delay, in milliseconds, as that second closes. */
export function onEventLoopSlice(listener: (p99Ms: number) => void): void {
  sliceListeners.add(listener);
}

/** The loop's delay at `percentile` over the last few seconds, in milliseconds; 0 before any sample. */
export function eventLoopDelayMs(percentile: number): number {
  if (!current) return 0;
  const window = createHistogram();
  for (const slice of [...slices, current]) window.add(slice);
  // The window's span from before the watch began counts as samples at rest, so the first few
  // samples after boot do not each decide it alone; past the window's length nothing is added.
  const unwatched = Math.ceil(Math.max(0, SLICES * SLICE_MS - (performance.now() - startedAt)) / SAMPLE_MS);
  for (let i = 0; i < unwatched; i++) window.record(1);
  return window.count === 0 ? 0 : window.percentile(percentile) / 1e6;
}
