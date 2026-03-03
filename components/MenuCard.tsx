import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Colors, Spacing, Radius, FontSize, Shadow } from '@/lib/theme';

interface MenuCardProps {
  children: React.ReactNode;
  title?: string;
  style?: ViewStyle;
  width?: number | string;
}

export function MenuCard({ children, title, style, width = '100%' }: MenuCardProps) {
  return (
    <View style={[styles.wrapper, { width } as any, style]}>
      {title && <Text style={styles.title}>{title}</Text>}
      <View style={styles.card}>
        {children}
      </View>
    </View>
  );
}

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
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.dark,
  },
});
