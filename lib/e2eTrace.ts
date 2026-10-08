import { useEffect } from "react";

/** One animation frame of the table, as `tests/e2e/helpers/mockupParity.ts` compares it with its mockup's. */
export interface TraceFrame {
  t: number;
  /** `sound:<key>`, `haptic:<helper>` or `moment:<name>`, each in the frame it fired in. */
  onsets: string[];
  live: number;
  dropped: number;
  lamp: { x: number; y: number; level: number | null; flare: number | null; r: number; ph?: number; freeze?: number } | null;
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

if (process.env.EXPO_PUBLIC_E2E_FAST === "1") {
  const frames: TraceFrame[] = [];
  const tick = (t: number) => {
    if (!recording) return;
    frames.push({
      t,
      onsets: pending.splice(0),
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
    });
    requestAnimationFrame(tick);
  };
  const recorder: TraceRecorder = {
    frames,
    start() {
      frames.length = 0;
      pending = [];
      if (!recording) requestAnimationFrame(tick);
      recording = true;
    },
    stop() {
      recording = false;
    },
  };
  (globalThis as { murlanTrace?: TraceRecorder }).murlanTrace = recorder;
}

export function traceOnset(kind: "sound" | "haptic" | "moment", name: string): void {
  if (recording) pending.push(`${kind}:${name}`);
}

/** Registers what this component draws with the trace, for as long as it is mounted. */
export function useTraceSource<K extends keyof Sources>(field: K, read: Sources[K]): void {
  useEffect(() => {
    if (process.env.EXPO_PUBLIC_E2E_FAST !== "1") return;
    sources[field].add(read);
    return () => {
      sources[field].delete(read);
    };
  }, [field, read]);
}
