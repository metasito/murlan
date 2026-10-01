import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";
import type { View } from "react-native";
import type { DiagRow } from "./types";
import type { LampSide, Pixels } from "./lampLegibility";

export type { DiagRow, DiagRows } from "./types";

export const DIAGNOSTICS = process.env.EXPO_PUBLIC_DIAGNOSTICS === "1";

const recorder: { push(row: DiagRow): void } | null =
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- a static import would ship the recorder
  process.env.EXPO_PUBLIC_DIAGNOSTICS === "1" ? require("./recorder").recorder : null;

export function diag(row: DiagRow): void {
  recorder?.push(row);
}

export function jsFromWall(): (wall: number) => number {
  const offset = performance.now() - Date.now();
  return (wall) => wall + offset;
}

export interface TableAnchors {
  width: number;
  height: number;
  /** Each seat's anchor, in the felt box's points. */
  anchors: Readonly<Record<LampSide, { x: number; y: number }>>;
  /** The seat-name boxes the felt dims, in the same points: holes in each ring. */
  names: readonly { x: number; y: number; w: number; h: number }[];
}

export interface BenchHandles {
  cardPress?: (id: string) => void;
  feltSnapshot?: () => Promise<Pixels | null>;
  feltOpaque?: (on: boolean) => void;
  lampFreeze?: (amount: number) => void;
  tableAnchors?: () => TableAnchors;
}

export const benchHandles: BenchHandles = {};

export function useBenchHandle<K extends keyof BenchHandles>(name: K, fn: NonNullable<BenchHandles[K]>): void {
  useEffect(() => {
    if (!DIAGNOSTICS) return;
    benchHandles[name] = fn;
    return () => {
      if (benchHandles[name] === fn) delete benchHandles[name];
    };
  }, [name, fn]);
}

export const RING_PROBE_MS = 250;

let ringProbeOn = false;
const ringProbeListeners = new Set<() => void>();
const ringProbeState = () => ringProbeOn;

function subscribeRingProbe(listener: () => void): () => void {
  ringProbeListeners.add(listener);
  return () => ringProbeListeners.delete(listener);
}

export function setRingProbe(on: boolean): void {
  ringProbeOn = on;
  for (const listener of ringProbeListeners) listener();
}

export function useRingProbe(name: string): RefObject<View | null> {
  const ref = useRef<View>(null);
  const on = useSyncExternalStore(subscribeRingProbe, ringProbeState, ringProbeState);
  useEffect(() => {
    if (!DIAGNOSTICS || !on) return;
    const id = setInterval(
      () => ref.current?.measureInWindow((x, y) => diag({ k: "ring", t: performance.now(), name, x, y })),
      RING_PROBE_MS
    );
    return () => clearInterval(id);
  }, [name, on]);
  return ref;
}
