import { useEffect, useState } from "react";
import { useFrameCallback, useSharedValue, type FrameInfo, type SharedValue } from "react-native-reanimated";
import { diag, jsFromWall } from "./index";

function sampler(samples: SharedValue<number[]>) {
  return (frame: FrameInfo) => {
    "worklet";
    const dt = frame.timeSincePreviousFrame;
    if (dt === null) return;
    samples.modify((a) => {
      "worklet";
      a.push(Date.now(), dt);
      return a;
    }, false);
  };
}

export function FrameProbe({ on }: { on: boolean }) {
  const samples = useSharedValue<number[]>([]);
  const [onFrame] = useState(() => sampler(samples));
  useFrameCallback(onFrame, on);
  useEffect(() => {
    if (on) return;
    const a = samples.value;
    const toJs = jsFromWall();
    for (let i = 0; i < a.length; i += 2) diag({ k: "frame", t: toJs(a[i]), dt: a[i + 1] });
    samples.set([]);
  }, [on, samples]);
  return null;
}
