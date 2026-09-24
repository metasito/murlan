import { useCallback, useState } from "react";
import type { FeltStops } from "@/lib/cosmetics";
import { useTraceSource } from "@/lib/e2eTrace";
import type { LampTarget } from "./lampRig";
import type { LampRig } from "./useLampRig";

export interface FeltProps {
  rig: LampRig;
  stops: FeltStops;
  /** Where the lamp is headed: the web fallback bakes its light there. */
  target: LampTarget;
}

/** Skia's readiness — loaded and its first frame drawn — for the trace; game information never waits on it. */
export function useFeltReady(): [boolean, () => void] {
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  useTraceSource(
    "felt",
    useCallback(() => (ready ? "skia" : "fallback"), [ready])
  );
  return [ready, onReady];
}
