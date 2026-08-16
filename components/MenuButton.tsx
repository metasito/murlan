import React from 'react';
import {
  Pressable, Text, StyleSheet,
  ViewStyle, ActivityIndicator, GestureResponderEvent,
} from 'react-native';
import { Colors, Spacing, Radius, FontSize, Shadow } from '@/lib/theme';

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
  accessibilityHint?: string;
}

const PRESSED_GHOST_BG = Colors.border;

export function MenuButton({
  label, onPress, variant = 'primary', size = 'md',
  disabled, loading, icon, style, fullWidth = true,
  accessibilityLabel, accessibilityHint,
}: MenuButtonProps) {
  const isDisabled = !!(disabled || loading);

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      hitSlop={Spacing.xs}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: !!loading }}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        sizeStyles[size],
        fullWidth && styles.fullWidth,
        pressed && !isDisabled && pressedStyles[variant],
        isDisabled && styles.disabled,
        style,
      ]}
    >
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
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.full,
    marginVertical: Spacing.xs,
    ...Shadow.dark,
  },
  fullWidth: { width: '100%' },
  label: {},

  primary: { backgroundColor: Colors.gold, ...Shadow.gold },
  secondary: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: Colors.gold },
  danger: { backgroundColor: Colors.danger },
  ghost: { backgroundColor: 'transparent' },

  disabled: { opacity: 0.4 },
});

const sizeStyles = StyleSheet.create({
  sm: { minHeight: 44, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.lg },
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
