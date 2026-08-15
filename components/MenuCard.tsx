import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Colors, Spacing, Radius, FontSize, Shadow } from '@/lib/theme';

type Padding = 'sm' | 'md' | 'lg';

interface MenuCardProps {
  children: React.ReactNode;
  title?: string;
  style?: ViewStyle;
  width?: number | string;
  padding?: Padding;
}

export function MenuCard({ children, title, style, width = '100%', padding = 'md' }: MenuCardProps) {
  return (
    <View style={[styles.wrapper, { width } as any, style]}>
      {title && (
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
      )}
      <View style={[styles.card, paddingStyles[padding]]}>
        {children}
      </View>
    </View>
  );
}

const paddingStyles = StyleSheet.create({
  sm: { padding: Spacing.sm },
  md: { padding: Spacing.md },
  lg: { padding: Spacing.lg },
});

const styles = StyleSheet.create({
  wrapper: { marginBottom: Spacing.md },
  title: {
    color: Colors.gold,
    fontFamily: 'Rajdhani_600SemiBold',
    fontSize: FontSize.sm,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: Spacing.xs,
    paddingLeft: Spacing.xs,
  },
  card: {
    backgroundColor: Colors.felt,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.dark,
  },
});
