import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, Spacing, Radius, FontSize, Highlight, Shadow } from '@/lib/theme';

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
        <LinearGradient
          colors={CARD_GRADIENT}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View pointerEvents="none" style={styles.topHighlight} />
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

// Lit from the top-left, like every other raised surface in the app, so a
// column of cards reads as one lighting model rather than as flat swatches.
const CARD_GRADIENT = [Colors.feltLight, Colors.felt, Colors.feltDark] as const;

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
    overflow: 'hidden',
    ...Shadow.dark,
  },
  topHighlight: {
    position: 'absolute',
    top: 0, left: Spacing.md, right: Spacing.md,
    height: 1,
    backgroundColor: Highlight.soft,
  },
});
