import React from 'react';
import {
  View, ScrollView, StyleSheet, Platform, ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/lib/theme';

const BACKDROP = [Colors.bg, Colors.bg, Colors.feltDark] as const;

const CONTENT_H_PAD = 20;

interface MenuLayoutProps {
  children: React.ReactNode;
  scrollable?: boolean;
  centered?: boolean;
  style?: ViewStyle;
  contentPad?: number;
}

export function MenuLayout({
  children,
  scrollable = true,
  centered = true,
  style,
  contentPad = CONTENT_H_PAD,
}: MenuLayoutProps) {
  const insets = useSafeAreaInsets();

  const paddingTop    = Platform.OS === 'web' ? 67 : Math.max(insets.top, contentPad);
  const paddingBottom = Platform.OS === 'web' ? 34 : Math.max(insets.bottom, contentPad);
  const paddingLeft   = insets.left  + contentPad;
  const paddingRight  = insets.right + contentPad;

  // `style` is merged last (after `centered`) so callers can override layout
  // — e.g. justifyContent — without it being clobbered by the centered preset.
  const contentStyle = [
    { paddingTop, paddingBottom, paddingLeft, paddingRight },
    centered && styles.centered,
    style,
  ];

  return (
    <View style={styles.root}>
      {/* A faint green cast rising from the bottom edge: the same felt the
          table is made of, read as a glow behind the menu rather than as a
          surface. A flat fill at this size reads as an empty canvas. */}
      <LinearGradient
        colors={BACKDROP}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {scrollable ? (
        <ScrollView
          style={styles.fill}
          contentContainerStyle={[styles.scroll, contentStyle]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, contentStyle]}>{children}</View>
      )}
    </View>
  );
}

export { CONTENT_H_PAD };

const styles = StyleSheet.create({
  root:     { flex: 1, backgroundColor: Colors.bg },
  fill:     { flex: 1 },
  scroll:   { flexGrow: 1 },
  centered: { justifyContent: 'center', alignItems: 'center' },
});
