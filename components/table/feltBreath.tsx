import { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Colors, Layer, motionMs } from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";

/** How much of the felt is still dark as the table appears, before the lamp comes up. */
const BREATH_DIM = 0.55;

/** The felt coming up out of the dark as the table appears. */
export function FeltBreath() {
  const reduceMotion = usePrefersReducedMotion();
  const breath = useSharedValue(BREATH_DIM);

  useEffect(() => {
    breath.value = withTiming(0, {
      duration: motionMs("reveal", reduceMotion),
      easing: Easing.inOut(Easing.sin),
    });
    return () => cancelAnimation(breath);
  }, [reduceMotion, breath]);

  const style = useAnimatedStyle(() => ({ opacity: breath.value }));
  return <Animated.View testID="felt-breath" style={[StyleSheet.absoluteFill, styles.breath, style]} />;
}

const styles = StyleSheet.create({
  breath: { backgroundColor: Colors.bg, zIndex: Layer.table },
});
