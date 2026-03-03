import React from 'react';
import {
  View, ScrollView, StyleSheet,
  useWindowDimensions, ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing } from '@/lib/theme';

interface MenuLayoutProps {
  children: React.ReactNode;
  scrollable?: boolean;
  centered?: boolean;
  style?: ViewStyle;
}

export function MenuLayout({ children, scrollable = true, centered = true, style }: MenuLayoutProps) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const paddingTop    = Math.max(insets.top    + Spacing.md, Spacing.lg);
  const paddingBottom = Math.max(insets.bottom + Spacing.md, Spacing.lg);
  const paddingLeft   = Math.max(insets.left   + Spacing.md, isLandscape ? Spacing.xl : Spacing.md);
  const paddingRight  = Math.max(insets.right  + Spacing.md, isLandscape ? Spacing.xl : Spacing.md);

  const containerStyle = [
    styles.root,
    { paddingTop, paddingBottom, paddingLeft, paddingRight },
    style,
  ];

  if (!scrollable) {
    return (
      <View style={[styles.root, containerStyle, centered && styles.centered]}>
        {children}
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.scroll, containerStyle, centered && styles.centered]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root:     { flex: 1, backgroundColor: Colors.bg },
  scroll:   { flexGrow: 1 },
  centered: { justifyContent: 'center', alignItems: 'center' },
});
