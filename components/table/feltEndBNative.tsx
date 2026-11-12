// End B of the settled felt, on native: a second Skia canvas over the felt, mounted and drawn only while the table rests,
// whose opacity a CSS animation carries along the lamp's sway while the felt holds end A (rule 51);
// docs/adr/0020-the-table-at-rest-plays-precomputed-tracks.md.
import { useEffect, useMemo, useState } from "react";
import { StyleSheet } from "react-native";
import Animated, { useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN, scheduleOnUI } from "react-native-worklets";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { afterFrames, useAmbient } from "@/lib/motion";
import { Layer } from "@/lib/tokens";
import type { EndsProps } from "./feltCanvas";
import { DRIFT_CHECK_MS, endTrack, isRested, NOT_SHOWN, nextShown, showsEnd, steering, type EndTrack, type Shown } from "./restEnds";

const MS_PER_S = 1000;
/** Frames from the commit that mounts end B, or starts its track, to showing it: its canvas's first draw and the animation's first frame are both behind that commit. */
export const START_FRAMES = 2;

/** A track as it starts, at `wall` on the page's clock: baked from where the rig is, so it starts at its own beginning. */
interface Started {
  track: EndTrack;
  wall: number;
}

function startTrack(rigNow: EndsProps["now"]): Started {
  const s = rigNow();
  return { track: endTrack(s.ph, s.t), wall: performance.now() };
}

export function EndBNative({ lamp, now: rigNow, settle, side, draw }: EndsProps) {
  const reduceMotion = usePrefersReducedMotion();
  const [started, setStarted] = useState<Started | null>(null);
  const shown = useSharedValue(0);
  const crossed = useSharedValue(0);

  // A worklet holds a copy of `NOT_SHOWN`, so the first frame is told by its NaN rather than by identity.
  const held = useSharedValue<Shown>(NOT_SHOWN);
  const end = useDerivedValue(() => {
    const s = lamp.value;
    if (!Number.isNaN(held.value.lx) && !showsEnd(s, 1)) return held.value;
    const next = nextShown(held.value, s, 1);
    if (next !== held.value) held.value = next;
    return next;
  });

  // The reaction is made again on each render and runs once as it is, so resting again must not restart a track that plays.
  const rest = (now: boolean) => setStarted((playing) => (now ? (playing ?? startTrack(rigNow)) : null));
  useAnimatedReaction(
    () => isRested(lamp.value) && settle.value === 0,
    (now, before) => {
      if (now === before) return;
      if (!now) {
        shown.set(0);
        side.set(0);
      }
      scheduleOnRN(rest, now);
    },
  );

  const engaged = started !== null && !reduceMotion;
  useEffect(() => {
    if (!engaged) return;
    return () => {
      shown.set(0);
      side.set(0);
    };
  }, [engaged, shown, side]);

  const spec = useMemo(() => (reduceMotion || !started ? null : started.track), [started, reduceMotion]);
  useEffect(() => {
    if (!started || reduceMotion) return;
    const cancel = afterFrames(START_FRAMES, () =>
      scheduleOnUI(() => {
        "worklet";
        if (!isRested(lamp.value) || settle.value !== 0) return;
        shown.set(1);
        side.set(-1);
      }),
    );
    // Native cannot read where its animation is: it is where it started plus the page's clock since, which the rig, stepping at most `MAX_DT` a frame, falls behind on a slow frame.
    const check = setInterval(() => {
      const place = (performance.now() - started.wall) / MS_PER_S;
      if (steering(started.track, place, rigNow().t).kind !== "none") setStarted(startTrack(rigNow));
    }, DRIFT_CHECK_MS);
    return () => {
      cancel();
      clearInterval(check);
    };
  }, [started, reduceMotion, lamp, settle, shown, side, rigNow]);

  const visible = useAnimatedStyle(() => ({ opacity: shown.value }));
  const sway = useAmbient(spec);
  // A new track restarts the animation, not the canvas: an element made again would be recorded and drawn again.
  const drawn = useMemo(() => engaged && draw(end, crossed), [engaged, draw, end, crossed]);
  return (
    <Animated.View testID="felt-end-b-layer" pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: Layer.feltEnd }, visible]}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, sway]}>
        {drawn}
      </Animated.View>
    </Animated.View>
  );
}
