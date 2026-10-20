import React, { useEffect } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { CardView, PRESS_RISE, PRESS_TILT } from "@/components/CardView";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { Motion } from "@/lib/theme";
import type { Card } from "@/lib/game/gameEngine";

const LIFT = -14;

interface TutorialCardProps {
  card: Card;
  selected: boolean;
  disabled?: boolean;
  /** Absent for a card shown but not offered: it keeps its name and is no button. */
  onPress?: () => void;
  testID?: string;
  style?: object;
}

/** A card the tutorial offers to tap: it lifts when selected and rises under the finger. */
export function TutorialCard({ card, selected, disabled = false, onPress, testID, style }: TutorialCardProps) {
  const reduceMotion = usePrefersReducedMotion();
  const translateY = useSharedValue(0);
  const press = useSharedValue(0);
  const interactive = !!onPress && !disabled;

  // Must precede the effects that capture `press` — the React Compiler skips a component that mutates a value an effect captured.
  const handlePressIn = () => {
    press.value = reduceMotion ? 1 : withSpring(1, Motion.spring.pickup);
  };
  const handlePressOut = () => {
    press.value = reduceMotion ? 0 : withSpring(0, Motion.spring.land);
  };

  useEffect(() => {
    const target = selected ? LIFT : 0;
    translateY.value = reduceMotion
      ? withTiming(target, { duration: Motion.duration.tap })
      : withSpring(target, Motion.spring.pickup);
  }, [selected, reduceMotion, translateY]);

  useEffect(
    () => () => {
      cancelAnimation(translateY);
      cancelAnimation(press);
    },
    [translateY, press]
  );

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value + press.value * PRESS_RISE },
      { rotate: `${press.value * PRESS_TILT}deg` },
    ],
  }));

  return (
    <Animated.View style={[animStyle, style]}>
      <Pressable
        testID={testID}
        accessible={false}
        focusable={false}
        disabled={!interactive}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
      >
        <View pointerEvents="none">
          <CardView card={card} selected={selected} disabled={disabled} onActivate={onPress} />
        </View>
      </Pressable>
    </Animated.View>
  );
}
