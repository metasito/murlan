import React from 'react';
import {
  View, ScrollView, StyleSheet, Platform, ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, WEB_BOTTOM_PAD, WEB_TOP_PAD } from '@/lib/theme';

const BACKDROP = [Colors.bg, Colors.bg, Colors.feltDark] as const;

const CONTENT_H_PAD = 20;
// The app is served as a web bundle, so a 1920-wide browser is a real viewport
// and an uncapped menu row puts its two ends a metre apart.
const MENU_MAX_W = 800;

interface MenuLayoutProps {
  children: React.ReactNode;
  scrollable?: boolean;
  centered?: boolean;
  style?: ViewStyle;
  contentPad?: number;
  /** `null` opts a screen out — for the landscape bodies that size their own columns. */
  maxWidth?: number | null;
}

export function MenuLayout({
  children,
  scrollable = true,
  centered = true,
  style,
  contentPad = CONTENT_H_PAD,
  maxWidth = MENU_MAX_W,
}: MenuLayoutProps) {
  const insets = useSafeAreaInsets();

  const paddingTop    = Platform.OS === 'web' ? WEB_TOP_PAD    : Math.max(insets.top, contentPad);
  const paddingBottom = Platform.OS === 'web' ? WEB_BOTTOM_PAD : Math.max(insets.bottom, contentPad);
  const paddingLeft   = insets.left  + contentPad;
  const paddingRight  = insets.right + contentPad;

  // `style` is merged last (after `centered`) so callers can override layout
  // — e.g. justifyContent — without it being clobbered by the centered preset.
  const contentStyle = [
    styles.bounded,
    { maxWidth: maxWidth ?? undefined },
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
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View testID="menu-content" style={contentStyle}>{children}</View>
        </ScrollView>
      ) : (
        <View style={styles.fill}>
          <View testID="menu-content" style={contentStyle}>{children}</View>
        </View>
      )}
    </View>
  );
}

export { CONTENT_H_PAD, MENU_MAX_W };

const styles = StyleSheet.create({
  root:     { flex: 1, backgroundColor: Colors.bg },
  fill:     { flex: 1 },
  scroll:   { flexGrow: 1 },
  // flexShrink defaults to 0 in React Native's flex model (unlike the web's
  // default of 1), so without it this container held its children's full
  // intrinsic height even when that exceeded the viewport — on a
  // `scrollable={false}` screen (room.tsx, lobby.tsx, quickmatch.tsx…) that
  // pushed the fixed footer below the fold instead of letting the screen's
  // own inner ScrollView take the overflow.
  bounded:  { width: '100%', alignSelf: 'center', flexGrow: 1, flexShrink: 1 },
  centered: { justifyContent: 'center', alignItems: 'center' },
});
