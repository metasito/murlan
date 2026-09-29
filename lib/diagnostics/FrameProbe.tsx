import { useEffect } from "react";
import { makeMutable, useFrameCallback, type FrameInfo } from "react-native-reanimated";
import { diag, jsFromWall } from "./index";

const recording = makeMutable(false);
const closeAtWall = makeMutable(Infinity);
const samples = makeMutable<number[]>([]);

let probe: { setActive(on: boolean): void } | null = null;
let armed = false;
let open: { at: number; until: number } | null = null;
const sync = () => probe?.setActive(armed);

export function sampleFrame(frame: FrameInfo): void {
  "worklet";
  const dt = frame.timeSincePreviousFrame;
  if (!recording.value || dt === null) return;
  const now = Date.now();
  samples.modify((a) => {
    "worklet";
    a.push(now, dt);
    return a;
  }, false);
  if (now >= closeAtWall.value) recording.value = false;
}

/** Keeps the frame loop running between windows, so each window's first frame has a previous one. */
export function armFrames(on: boolean): void {
  armed = on;
  sync();
}

/**
 * With `until` (JS time), the window records past it up to the first frame that ends after it; a
 * window closed with no such frame yet records the gap to the close as one interval.
 */
export function recordFrames(on: boolean, until = Infinity): void {
  if (on) {
    if (!armed) throw new Error("frames recorded with the frame loop unarmed: register the scenario with registerFramedScenario");
    open = { at: performance.now(), until };
    closeAtWall.value = until - (performance.now() - Date.now());
    recording.value = true;
    sync();
    return;
  }
  const waiting = open !== null && Number.isFinite(open.until) && recording.value;
  const openedAt = open?.at ?? performance.now();
  recording.value = false;
  open = null;
  sync();
  const a = samples.value;
  samples.set([]);
  const toJs = jsFromWall();
  for (let i = 0; i < a.length; i += 2) diag({ k: "frame", t: toJs(a[i]), dt: a[i + 1] });
  if (!waiting) return;
  const t = performance.now();
  diag({ k: "frame", t, dt: t - (a.length ? toJs(a[a.length - 2]) : openedAt) });
}

export function FrameProbe() {
  const callback = useFrameCallback(sampleFrame, false);
  useEffect(() => {
    probe = callback;
    sync();
    return () => {
      if (probe === callback) probe = null;
    };
  }, [callback]);
  return null;
}
