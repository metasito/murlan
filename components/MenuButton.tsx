import React, { useEffect, useState } from 'react';
import {
  Pressable, Text, StyleSheet, View,
  ViewStyle, ActivityIndicator, GestureResponderEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Colors, Spacing, Radius, FontSize, Highlight, Motion, Shadow, TOUCH_TARGET_MIN } from '@/lib/theme';
import { usePrefersReducedMotion } from '@/lib/accessibility';
import { A11yHintText, a11yHint, a11yState } from "@/lib/a11y";

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

interface MenuButtonProps {
  label: string;
  onPress: (e: GestureResponderEvent) => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
  fullWidth?: boolean;
  accessibilityLabel?: string;
  hint?: string;
}

const PRESSED_GHOST_BG = Colors.border;

// Whole-pixel travel. The button holds a text label, and React Native
// rasterises text before transforming it, so a fractional offset resamples the
// glyphs. 2px down is the smallest offset that still reads as a press.
const PRESS_TRAVEL = 2;

export function MenuButton({
  label, onPress, variant = 'primary', size = 'md',
  disabled, loading, icon, style, fullWidth = true,
  accessibilityLabel, hint,
}: MenuButtonProps) {
  const isDisabled = !!(disabled || loading);
  const reduceMotion = usePrefersReducedMotion();
  const [pressed, setPressed] = useState(false);
  const press = useSharedValue(0);

  useEffect(
    () => () => {
      cancelAnimation(press);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount cleanup only; press is a stable shared value
    []
  );

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: press.value * PRESS_TRAVEL }],
  }));

  const setPress = (down: boolean) => {
    if (isDisabled) return;
    setPressed(down);
    press.value = reduceMotion
      ? down ? 1 : 0
      : withTiming(down ? 1 : 0, { duration: Motion.duration.fast });
  };

  return (
    <Animated.View style={[fullWidth && styles.fullWidth, animStyle]}>
      <Pressable
        onPress={onPress}
        onPressIn={() => setPress(true)}
        onPressOut={() => setPress(false)}
        disabled={isDisabled}
        hitSlop={Spacing.xs}
        accessibilityLabel={accessibilityLabel ?? label}
        {...a11yHint(hint)}
        {...a11yState({ role: "button", disabled: isDisabled, busy: !!loading })}
        style={[
          styles.base,
          styles[variant],
          sizeStyles[size],
          fullWidth && styles.fullWidth,
          pressed && !isDisabled && pressedStyles[variant],
          isDisabled && styles.disabled,
          style,
        ]}
      >
        <A11yHintText hint={hint} />
        {variant === 'primary' && (
          <LinearGradient
            colors={pressed ? PRIMARY_GRADIENT_PRESSED : PRIMARY_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.35, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        )}
        {variant !== 'ghost' && <View pointerEvents="none" style={styles.topHighlight} />}
        {loading ? (
          <ActivityIndicator color={variant === 'primary' ? Colors.bg : Colors.gold} />
        ) : (
          <>
            {icon}
            <Text
              style={[styles.label, labelStyles[variant], sizeLabelStyles[size]]}
              numberOfLines={1}
            >
              {label}
            </Text>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

// A solid gold pill reads as a flat swatch. Raking the light across it — bright
// at the top-left corner, dropping to goldDark at the bottom-right — is what
// makes it read as a struck metal surface instead.
const PRIMARY_GRADIENT = [Colors.goldLight, Colors.gold, Colors.goldDark] as const;
const PRIMARY_GRADIENT_PRESSED = [Colors.gold, Colors.goldDark, Colors.goldDim] as const;

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.full,
    marginVertical: Spacing.xs,
    overflow: 'hidden',
    ...Shadow.dark,
  },
  fullWidth: { width: '100%' },
  label: {},
  // One hairline of light along the top edge: the cue that the surface has a
  // thickness and is facing up.
  topHighlight: {
    position: 'absolute',
    top: 0, left: '12%', right: '12%',
    height: 1,
    backgroundColor: Highlight.clear,
  },

  primary: { backgroundColor: Colors.gold, ...Shadow.gold },
  secondary: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: Colors.gold },
  danger: { backgroundColor: Colors.danger },
  ghost: { backgroundColor: 'transparent' },

  disabled: { opacity: 0.4 },
});

const sizeStyles = StyleSheet.create({
  sm: { minHeight: TOUCH_TARGET_MIN, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.lg },
  md: { minHeight: 52, paddingVertical: Spacing.md, paddingHorizontal: Spacing.xl },
  lg: { minHeight: 60, paddingVertical: Spacing.lg, paddingHorizontal: Spacing.xl },
});

const sizeLabelStyles = StyleSheet.create({
  sm: { fontSize: FontSize.md },
  md: { fontSize: FontSize.lg },
  lg: { fontSize: FontSize.xl },
});

const labelStyles = StyleSheet.create({
  primary: { color: Colors.bg, fontFamily: 'Rajdhani_700Bold' },
  secondary: { color: Colors.gold, fontFamily: 'Rajdhani_600SemiBold' },
  danger: { color: Colors.white, fontFamily: 'Rajdhani_700Bold' },
  ghost: { color: Colors.textSecondary, fontFamily: 'Inter_400Regular' },
});

// Real pressed states — distinct from `disabled`, applied only while the
// finger is down and the button is interactive.
const pressedStyles = StyleSheet.create({
  primary: { backgroundColor: Colors.goldDark },
  secondary: { backgroundColor: Colors.goldMuted, borderColor: Colors.goldLight },
  danger: { backgroundColor: Colors.dangerDim },
  ghost: { backgroundColor: PRESSED_GHOST_BG },
});
