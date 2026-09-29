import { makeMutable, useFrameCallback, type FrameInfo } from "react-native-reanimated";
import { diag, jsFromWall } from "./index";

const recording = makeMutable(false);
const samples = makeMutable<number[]>([]);

function sample(frame: FrameInfo): void {
  "worklet";
  const dt = frame.timeSincePreviousFrame;
  if (!recording.value || dt === null) return;
  samples.modify((a) => {
    "worklet";
    a.push(Date.now(), dt);
    return a;
  }, false);
}

export function recordFrames(on: boolean): void {
  recording.value = on;
  if (on) return;
  const a = samples.value;
  samples.set([]);
  const toJs = jsFromWall();
  for (let i = 0; i < a.length; i += 2) diag({ k: "frame", t: toJs(a[i]), dt: a[i + 1] });
}

/** Always running, so a window's first frame has a previous one; recording is a shared value, so opening a window renders nothing. */
export function FrameProbe() {
  useFrameCallback(sample);
  return null;
}
