import React from 'react';
import {
  TouchableOpacity, Text, StyleSheet,
  ViewStyle, ActivityIndicator,
} from 'react-native';
import { Colors, Spacing, Radius, FontSize, Shadow } from '@/lib/theme';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface MenuButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
  fullWidth?: boolean;
}

export function MenuButton({
  label, onPress, variant = 'primary',
  disabled, loading, icon, style, fullWidth = true,
}: MenuButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      style={[
        styles.base,
        styles[variant],
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled }}
    >
      {loading
        ? <ActivityIndicator color={variant === 'primary' ? Colors.bg : Colors.gold} />
        : <>
            {icon && <>{icon}</>}
            <Text style={[styles.label, styles[`${variant}Label` as any]]}>{label}</Text>
          </>
      }
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.full,
    minHeight: 52,
    marginVertical: Spacing.xs,
    ...Shadow.dark,
  },
  fullWidth: { width: '100%' },
  primary: { backgroundColor: Colors.gold, ...Shadow.gold },
  primaryLabel: { color: Colors.bg, fontFamily: 'Rajdhani_700Bold', fontSize: FontSize.lg },
  secondary: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: Colors.gold },
  secondaryLabel: { color: Colors.gold, fontFamily: 'Rajdhani_600SemiBold', fontSize: FontSize.lg },
  danger: { backgroundColor: Colors.danger },
  dangerLabel: { color: Colors.white, fontFamily: 'Rajdhani_700Bold', fontSize: FontSize.lg },
  ghost: { backgroundColor: 'transparent' },
  ghostLabel: { color: Colors.textSecondary, fontFamily: 'Inter_400Regular', fontSize: FontSize.md },
  disabled: { opacity: 0.4 },
  label: {},
});
