// A continuous 0..1 control on the gesture-handler + reanimated already in
// the app. `@react-native-community/slider` was the obvious dependency and
// is not the answer: its react-native-web layer is the one part of this
// app's web build it would put at risk (#342).
import { useCallback } from "react";
import { Platform, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";
import Animated, { useAnimatedStyle, useDerivedValue, useSharedValue, withTiming } from "react-native-reanimated";
import { physicalTouchTarget } from "@/components/cardFaceModel";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { a11yHidden, a11yState, a11yValue } from "@/lib/a11y";
import { Colors, Motion, Radius, TOUCH_TARGET_MIN } from "@/lib/theme";

const TRACK_H = 4;
// The floor is physical size, not a fraction of the track — same rule as the
// control rail's knobs (components/cardFaceModel.ts).
const THUMB = physicalTouchTarget(1);
/** One VoiceOver/keyboard press worth of adjustment. */
const STEP = 0.05;
const DISABLED_OPACITY = 0.4;

function clamp(v: number): number {
  "worklet";
  return Math.min(1, Math.max(0, v));
}

export function Slider({
  value,
  onValueChange,
  a11yLabel,
  valueText,
  disabled = false,
}: {
  value: number;
  onValueChange: (next: number) => void;
  a11yLabel: string;
  /** Announced by VoiceOver/TalkBack as the control's current value. */
  valueText: string;
  disabled?: boolean;
}) {
  const reduceMotion = usePrefersReducedMotion();
  // The usable travel: the container's own width, minus the thumb, so the
  // thumb's centre never leaves it.
  const travel = useSharedValue(0);
  // Live only while a finger is on the thumb — `value` (the settled prop) is
  // read directly the rest of the time, through `displayProgress` below.
  // Never synced from `value` via an effect: a shared value written by both
  // a gesture and a `useEffect` is one the React Compiler refuses to compile
  // (tests/reactCompiler.test.ts).
  const isDragging = useSharedValue(false);
  const dragStart = useSharedValue(value);
  const dragProgress = useSharedValue(value);

  function onLayout(e: LayoutChangeEvent) {
    travel.value = Math.max(0, e.nativeEvent.layout.width - THUMB);
  }

  const step = useCallback(
    (delta: number) => {
      if (disabled) return;
      onValueChange(clamp(value + delta));
    },
    [disabled, onValueChange, value]
  );

  const pan = Gesture.Pan()
    .enabled(!disabled)
    .onStart(() => {
      isDragging.value = true;
      dragStart.value = value;
    })
    .onUpdate((e) => {
      if (travel.value <= 0) return;
      dragProgress.value = clamp(dragStart.value + e.translationX / travel.value);
      scheduleOnRN(onValueChange, dragProgress.value);
    })
    .onEnd(() => {
      isDragging.value = false;
    });

  const displayProgress = useDerivedValue(() => {
    if (isDragging.value) return dragProgress.value;
    return withTiming(value, { duration: reduceMotion ? 0 : Motion.duration.fast });
  });

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: displayProgress.value * travel.value }],
  }));
  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: Math.max(displayProgress.value, 0.001) }],
  }));

  // react-native-web forwards this straight to the DOM; native reaches
  // "adjustable" through VoiceOver/TalkBack's own swipe gesture instead.
  const webKeyProps =
    Platform.OS === "web"
      ? {
          tabIndex: (disabled ? -1 : 0) as 0 | -1,
          onKeyDown: (e: { key: string; preventDefault?: () => void }) => {
            if (e.key === "ArrowRight") {
              e.preventDefault?.();
              step(STEP);
            } else if (e.key === "ArrowLeft") {
              e.preventDefault?.();
              step(-STEP);
            }
          },
        }
      : {};

  return (
    <GestureDetector gesture={pan}>
      <View
        onLayout={onLayout}
        style={[styles.container, disabled && styles.disabled]}
        accessibilityLabel={a11yLabel}
        {...a11yState({ role: "adjustable", disabled })}
        {...a11yValue({ min: 0, max: 1, now: value, text: valueText })}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === "increment") step(STEP);
          else if (e.nativeEvent.actionName === "decrement") step(-STEP);
        }}
        {...webKeyProps}
      >
        <View style={styles.track} {...a11yHidden()}>
          <Animated.View style={[styles.fill, fillStyle]} />
        </View>
        <Animated.View style={[styles.thumb, thumbStyle]} {...a11yHidden()} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: TOUCH_TARGET_MIN,
    justifyContent: "center",
  },
  disabled: { opacity: DISABLED_OPACITY },
  track: {
    height: TRACK_H,
    borderRadius: Radius.full,
    backgroundColor: Colors.bgElevated,
    overflow: "hidden",
  },
  fill: {
    flex: 1,
    borderRadius: Radius.full,
    backgroundColor: Colors.gold,
    transformOrigin: "left",
  },
  thumb: {
    position: "absolute",
    width: THUMB,
    height: THUMB,
    borderRadius: Radius.full,
    backgroundColor: Colors.gold,
  },
});
