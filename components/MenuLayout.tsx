import React from 'react';
import {
  View, ScrollView, StyleSheet, Platform, ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/lib/theme';

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

  if (!scrollable) {
    return <View style={[styles.root, contentStyle]}>{children}</View>;
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.scroll, contentStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

export { CONTENT_H_PAD };

const styles = StyleSheet.create({
  root:     { flex: 1, backgroundColor: Colors.bg },
  scroll:   { flexGrow: 1 },
  centered: { justifyContent: 'center', alignItems: 'center' },
});
