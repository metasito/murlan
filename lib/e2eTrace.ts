import { useEffect } from "react";

/** One animation frame of the table, as `tests/e2e/helpers/mockupParity.ts` compares it with its mockup's. */
export interface TraceFrame {
  t: number;
  /** `sound:<key>`, `haptic:<helper>` or `moment:<name>`, each in the frame it fired in. */
  onsets: string[];
  live: number;
  dropped: number;
  lamp: { x: number; y: number; level: number | null; flare: number | null; r: number; ph?: number; freeze?: number; kick?: number; clock?: number } | null;
  shake: { x: number; y: number; rotate: number } | null;
  /** Which felt is on screen: the web fallback until Skia has drawn its first frame. */
  felt?: "skia" | "fallback" | null;
  /** The score pill's box and its open progress, which may overshoot 1. */
  scorePill: { x: number; y: number; w: number; h: number; open: number } | null;
  flight: number;
  /** The motes the light draws this frame, of the 40 `live` counts. */
  motes: number;
  /** The moth's body, while one crosses the light. */
  moth: { x: number; y: number } | null;
  /** The grey over the table while the viewer's own link is down, 0 to 1. */
  grey?: number;
  /** The felt's scale through the deal's breath, 1 at rest. */
  breath?: number;
  /** Each seat ring's turn clock opacity, by the side it sits on. */
  clocks?: Record<string, number>;
}

interface Sources {
  live: () => number;
  dropped: () => number;
  motes: () => number;
  moth: () => TraceFrame["moth"];
  lamp: () => NonNullable<TraceFrame["lamp"]>;
  shake: () => NonNullable<TraceFrame["shake"]>;
  felt: () => "skia" | "fallback";
  scorePill: () => NonNullable<TraceFrame["scorePill"]>;
  flight: () => number;
  grey: () => number;
  breath: () => number;
  clock: () => readonly [string, number];
}

export interface TraceRecorder {
  frames: TraceFrame[];
  start(): void;
  stop(): void;
}

const sources: { [K in keyof Sources]: Set<Sources[K]> } = {
  live: new Set(),
  dropped: new Set(),
  motes: new Set(),
  moth: new Set(),
  lamp: new Set(),
  shake: new Set(),
  felt: new Set(),
  scorePill: new Set(),
  flight: new Set(),
  grey: new Set(),
  breath: new Set(),
  clock: new Set(),
};
let recording = false;
let pending: string[] = [];

function sum(reads: Set<() => number>): number {
  let n = 0;
  for (const read of reads) n += read();
  return n;
}

function last<T>(reads: Set<() => T>): T | null {
  let value: T | null = null;
  for (const read of reads) value = read();
  return value;
}

export interface FrameHost {
  requestAnimationFrame(callback: (t: number) => void): number;
  cancelAnimationFrame(id: number): void;
}

/**
 * Samples a frame again after each of its frame callbacks and the microtasks it queued, replacing the last
 * sample, so whichever callback the host runs last leaves the frame read as it ended. `sample` is handed the
 * sample it replaces, to carry forward what it drained.
 */
export function recordFrames<F>(
  host: FrameHost,
  sample: (t: number, replacing: F | undefined) => F
): { frames: F[]; start(): void; stop(): void } {
  const frames: F[] = [];
  let on = false;
  let latest: number | null = null;
  const request = host.requestAnimationFrame.bind(host);
  host.requestAnimationFrame = (callback) =>
    request((t) => {
      try {
        callback(t);
      } finally {
        queueMicrotask(() => {
          if (!on) return;
          if (latest === t) frames[frames.length - 1] = sample(t, frames.at(-1));
          else frames.push(sample(t, undefined));
          latest = t;
        });
      }
    });
  const tick = () => {
    if (on) host.requestAnimationFrame(tick);
  };
  return {
    frames,
    start() {
      frames.length = 0;
      latest = null;
      if (!on) host.requestAnimationFrame(tick);
      on = true;
    },
    stop() {
      on = false;
    },
  };
}

export function traceRecorder(host: FrameHost): TraceRecorder {
  const trace = recordFrames<TraceFrame>(host, (t, replacing) => ({
    t,
    onsets: [...(replacing?.onsets ?? []), ...pending.splice(0)],
    live: sum(sources.live),
    dropped: sum(sources.dropped),
    lamp: last(sources.lamp),
    shake: last(sources.shake),
    felt: last(sources.felt),
    scorePill: last(sources.scorePill),
    flight: Math.max(0, ...[...sources.flight].map((read) => read())),
    motes: sum(sources.motes),
    moth: last(sources.moth),
    grey: last(sources.grey) ?? 0,
    breath: last(sources.breath) ?? 1,
    clocks: Object.fromEntries([...sources.clock].map((read) => read())),
  }));
  return {
    frames: trace.frames,
    start() {
      pending = [];
      trace.start();
      recording = true;
    },
    stop() {
      trace.stop();
      recording = false;
    },
  };
}

if (process.env.EXPO_PUBLIC_E2E_FAST === "1") {
  (globalThis as { murlanTrace?: TraceRecorder }).murlanTrace = traceRecorder(globalThis as unknown as FrameHost);
}

export function traceOnset(kind: "sound" | "haptic" | "moment", name: string): void {
  if (recording) pending.push(`${kind}:${name}`);
}

/** Registers what this component draws with the trace, for as long as it is mounted. */
export function useTraceSource<K extends keyof Sources>(field: K, read: Sources[K] | null): void {
  useEffect(() => {
    if (process.env.EXPO_PUBLIC_E2E_FAST !== "1" || !read) return;
    sources[field].add(read);
    return () => {
      sources[field].delete(read);
    };
  }, [field, read]);
}
