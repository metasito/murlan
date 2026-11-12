// End B of the settled felt, on native: a second Skia canvas over the felt, drawn once per rest, whose opacity a
// CSS animation carries along the lamp's sway while the felt holds end A (rule 51);
// docs/adr/0020-the-table-at-rest-plays-precomputed-tracks.md.
import { useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import Animated, { useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN, scheduleOnUI } from "react-native-worklets";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { FeltDraws } from "@/lib/diagnostics/feltDraws";
import { useAmbient } from "@/lib/motion";
import { Layer } from "@/lib/tokens";
import type { EndsProps } from "./feltCanvas";
import { DRIFT_CHECK_MS, endTrack, isRested, NOT_SHOWN, nextShown, showsEnd, steering, type EndTrack, type Shown } from "./restEnds";

const OVER_END_A = Layer.felt + 1;
const MS_PER_S = 1000;

export function EndBNative({ lamp, now: rigNow, settle, side, draw }: EndsProps) {
  const reduceMotion = usePrefersReducedMotion();
  const [steady, setSteady] = useState(false);
  const [playing, setPlaying] = useState<EndTrack | null>(null);
  const startedAt = useRef(0);
  const shown = useSharedValue(0);
  const crossed = useSharedValue(0);

  // A worklet holds a copy of `NOT_SHOWN`, so the first frame is told by its NaN rather than by identity.
  const held = useSharedValue<Shown>(NOT_SHOWN);
  const end = useDerivedValue(() => {
    const s = lamp.value;
    if (!Number.isNaN(held.value.lx) && !showsEnd(s, 1)) return held.value;
    const next = nextShown(held.value, s, 1);
    if (next !== held.value) {
      held.value = next;
      FeltDraws.end.value += 1;
    }
    return next;
  });

  useAnimatedReaction(
    () => isRested(lamp.value) && settle.value === 0,
    (now, before) => {
      if (now === before) return;
      if (!now) {
        shown.set(0);
        side.set(0);
      }
      scheduleOnRN(setSteady, now);
    },
  );

  const engaged = steady && !reduceMotion;
  const baked = useRef<EndTrack | null>(null);
  useEffect(() => {
    if (!engaged) return;
    const bake = () => {
      const s = rigNow();
      baked.current = endTrack(s.ph, s.t);
      setPlaying(baked.current);
    };
    bake();
    // Native cannot seek an animation: a track that drifts from the rig is baked again from where the rig is.
    const check = setInterval(() => {
      if (!baked.current) return;
      const place = (performance.now() - startedAt.current) / MS_PER_S;
      if (steering(baked.current, place, rigNow().t).kind !== "none") bake();
    }, DRIFT_CHECK_MS);
    return () => {
      clearInterval(check);
      baked.current = null;
      setPlaying(null);
      shown.set(0);
      side.set(0);
    };
  }, [engaged, rigNow, shown, side]);

  // The animation starts with the commit that carries it, so that is when end A is held under it.
  useEffect(() => {
    if (!playing) return;
    startedAt.current = performance.now();
    scheduleOnUI(() => {
      "worklet";
      if (!isRested(lamp.value) || settle.value !== 0) return;
      shown.set(1);
      side.set(-1);
    });
  }, [playing, lamp, settle, shown, side]);

  const visible = useAnimatedStyle(() => ({ opacity: shown.value }));
  const sway = useAmbient(playing);
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: OVER_END_A }, visible]}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, sway]}>
        {draw(end, crossed)}
      </Animated.View>
    </Animated.View>
  );
}
