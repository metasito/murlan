// End B of the settled felt, on web: a 2D canvas over the Skia felt, filled once from it, whose opacity a
// compositor animation carries along the lamp's sway. The Skia canvas keeps end A and draws nothing while
// the table rests (rule 51).
import { useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  useAnimatedReaction,
  useSharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { afterFrames, inOneFrame, useAmbient } from "@/lib/motion";
import { TRACK_SECONDS } from "@/lib/swayTable";
import {
  endTrack,
  isRested,
  QUIET_MS,
  REBAKE_BEFORE_MS,
  type EndTrack,
} from "./restEnds";
import type { FeltEnds, FeltEndsArgs } from "./feltEnds";

/** The canvas a track plays on and the keyframes' frame, kept together so a stale one cannot pair with a new canvas. */
type Playing = EndTrack;

function copyOf(host: unknown, into: HTMLCanvasElement | null): boolean {
  const from = (host as HTMLElement | null)?.querySelector("canvas");
  if (!from || !into || from.width === 0 || from.height === 0) return false;
  if (into.width !== from.width || into.height !== from.height) {
    into.width = from.width;
    into.height = from.height;
  }
  // The felt's drawing buffer is display-p3 (SkiaPictureView.web.js): a 2D canvas in sRGB would convert it.
  const context =
    into.getContext("2d", { colorSpace: "display-p3" }) ??
    into.getContext("2d");
  if (!context) return false;
  context.drawImage(from, 0, 0);
  return true;
}

export function useFeltEnds({
  lamp,
  settle,
  content,
  host,
}: FeltEndsArgs): FeltEnds {
  const reduceMotion = usePrefersReducedMotion();
  const side = useSharedValue(0);
  const [steady, setSteady] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const [playing, setPlaying] = useState<Playing | null>(null);
  const layer = useRef<HTMLCanvasElement>(null);
  const quietTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useAnimatedReaction(
    () => isRested(lamp.value) && settle.value === 0,
    (now, before) => {
      if (now !== before) scheduleOnRN(setSteady, now);
    },
  );

  const [onContent] = useState(() => () => {
    setQuiet(false);
    if (quietTimer.current) clearTimeout(quietTimer.current);
    quietTimer.current = setTimeout(() => setQuiet(true), QUIET_MS);
  });
  useAnimatedReaction(
    () => content.value,
    (now, before) => {
      if (before !== null && now !== before) scheduleOnRN(onContent);
    },
  );
  useEffect(() => {
    onContent();
    return () => {
      if (quietTimer.current) clearTimeout(quietTimer.current);
    };
  }, [onContent]);

  const engaged = steady && quiet && !reduceMotion;
  useEffect(() => {
    const canvas = layer.current;
    if (!engaged || !canvas) return;
    let live = true;
    const bake = () => {
      const s = lamp.get();
      setPlaying(endTrack(s.ph, s.t, 0));
    };
    bake();
    let cancelFrame = () => {};
    // Two frames for the track to commit and start. Then both steps in one frame: the felt draws end B between them, the second copies it and draws end A back, so end B is never presented.
    const cancelWait = afterFrames(2, () => {
      cancelFrame = inOneFrame([
        () => live && side.set(1),
        () => {
          if (!live) return;
          if (copyOf(host.current, canvas)) {
            canvas.style.visibility = "visible";
            side.set(-1);
          } else side.set(0);
        },
      ]);
    });
    const again = setInterval(bake, TRACK_SECONDS * 1000 - REBAKE_BEFORE_MS);
    return () => {
      live = false;
      cancelWait();
      cancelFrame();
      clearInterval(again);
      canvas.style.visibility = "hidden";
      side.set(0);
      setPlaying(null);
    };
  }, [engaged, lamp, side, host]);

  const style = useAmbient(playing);
  return {
    side,
    layer: (
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, style]}
      >
        <canvas
          ref={layer}
          style={{ visibility: "hidden", width: "100%", height: "100%" }}
        />
      </Animated.View>
    ),
  };
}
