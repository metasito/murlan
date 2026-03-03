import React from 'react';
import {
  View, ScrollView, StyleSheet, Platform,
  useWindowDimensions, ViewStyle,
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
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const paddingTop    = Platform.OS === 'web' ? 67 : Math.max(insets.top, contentPad);
  const paddingBottom = Platform.OS === 'web' ? 34 : Math.max(insets.bottom, contentPad);
  const paddingLeft   = insets.left  + contentPad;
  const paddingRight  = insets.right + contentPad;

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

export { CONTENT_H_PAD };

const styles = StyleSheet.create({
  root:     { flex: 1, backgroundColor: Colors.bg },
  scroll:   { flexGrow: 1 },
  centered: { justifyContent: 'center', alignItems: 'center' },
});
