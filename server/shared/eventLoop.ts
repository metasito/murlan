import { createHistogram, performance, type RecordableHistogram } from "node:perf_hooks";

const SAMPLE_MS = 10;
const SLICE_MS = 1_000;
/** The window a percentile is read over: this many slices, plus the one filling now. */
const SLICES = 5;

let current: RecordableHistogram | null = null;
let slices: RecordableHistogram[] = [];
let startedAt = 0;

function unref(timer: ReturnType<typeof setInterval>): void {
  (timer as unknown as { unref?: () => void }).unref?.();
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
    slices = [...slices, filling].slice(-SLICES);
    filling = createHistogram();
    current = filling;
  }, SLICE_MS);
  unref(sample);
  unref(rotate);
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
