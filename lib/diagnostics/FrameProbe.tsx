import { useEffect } from "react";
import { makeMutable, useFrameCallback, type FrameInfo } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { diag, jsFromWall } from "./index";

const recording = makeMutable(false);
const closeAtWall = makeMutable(Infinity);
const samples = makeMutable<number[]>([]);

let probe: { setActive(on: boolean): void } | null = null;
let armed = false;
let open: { at: number; until: number } | null = null;
const awaitingFrame = makeMutable(false);
let firstFrame: (() => void) | null = null;
const sync = () => probe?.setActive(armed);

function frameSeen(): void {
  firstFrame?.();
  firstFrame = null;
}

export function sampleFrame(frame: FrameInfo): void {
  "worklet";
  if (awaitingFrame.value) {
    awaitingFrame.value = false;
    scheduleOnRN(frameSeen);
  }
  if (!recording.value) return;
  const dt = frame.timeSincePreviousFrame ?? NaN;
  const now = Date.now();
  // Forced: an unforced write of the same array never marks it dirty, so JS reads its stale copy.
  samples.modify((a) => {
    "worklet";
    a.push(now, dt);
    return a;
  }, true);
  if (now >= closeAtWall.value) recording.value = false;
}

/** Resolves on the loop's first frame, whose interval is null: from then on every frame has one. */
export function armFrames(on: boolean): Promise<void> {
  armed = on;
  frameSeen();
  awaitingFrame.value = on;
  const seen = on
    ? new Promise<void>((resolve, reject) => {
        firstFrame = resolve;
        setTimeout(() => reject(new Error("the frame loop ran no frame within 1 s of arming")), 1000);
      })
    : Promise.resolve();
  sync();
  return seen;
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
