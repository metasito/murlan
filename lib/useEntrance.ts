import { useEffect } from "react";
import {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { Motion, motionMs } from "@/lib/theme";

/** One item after another, so the screen assembles rather than appearing. */
const ENTRANCE_STEP_MS = Motion.duration.tap;
/** How far an entering item travels. */
const RISE = 24;

export function useEntrance(step: number) {
  const reduceMotion = usePrefersReducedMotion();
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(reduceMotion ? 0 : RISE);

  useEffect(() => {
    const delay = step * ENTRANCE_STEP_MS;
    opacity.value = withDelay(delay, withTiming(1, { duration: motionMs("reveal", reduceMotion) }));
    translateY.value = reduceMotion
      ? 0
      : withDelay(
          delay,
          withTiming(0, { duration: Motion.duration.reveal, easing: Easing.out(Easing.cubic) })
        );
  }, [opacity, reduceMotion, step, translateY]);

  return useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));
}
