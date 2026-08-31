import React from 'react';
import {
  View, ScrollView, StyleSheet, Platform, ViewStyle, KeyboardAvoidingView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/lib/theme';
import { useBannerBottom } from '@/context/NotificationContext';
import { TOP_GAP } from '@/components/NotificationBanner';

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
  const bannerBottom = useBannerBottom();

  const paddingTop    = Math.max(insets.top, contentPad);
  const paddingBottom = Math.max(insets.bottom, contentPad);
  const paddingLeft   = insets.left  + contentPad;
  const paddingRight  = insets.right + contentPad;

  // A banner floats over the navigator at a z-index above it, so nothing here
  // is told it is there and the screen would otherwise lay itself out under it.
  const reserved = Math.max(0, bannerBottom + TOP_GAP - paddingTop);

  // `style` is merged last (after `centered`) so callers can override layout
  // — e.g. justifyContent — without it being clobbered by the centered preset.
  const contentStyle = [
    styles.bounded,
    { maxWidth: maxWidth ?? undefined },
    { paddingTop: paddingTop + reserved, paddingBottom, paddingLeft, paddingRight },
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
      {/* Every menu screen with a text field routes through here. Android's
          edge-to-edge, unconditional since Expo SDK 54, stopped the framework
          padding the window for the IME, so `adjustResize` alone no longer
          reflows anything — KeyboardAvoidingView reads the keyboard events
          itself instead. iOS is served by the ScrollView's own inset
          adjustment, and on web both are inert: the browser scrolls the
          focused input into view. */}
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'android' ? 'padding' : undefined}
      >
        {scrollable ? (
          <ScrollView
            style={styles.fill}
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
            showsVerticalScrollIndicator={false}
          >
            <View testID="menu-content" style={contentStyle}>{children}</View>
          </ScrollView>
        ) : (
          <View style={styles.fill}>
            <View testID="menu-content" style={contentStyle}>{children}</View>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

/**
 * The one region of a screen that absorbs spare height, so a tall window is a
 * bigger screen rather than the same screen with a void under it.
 *
 * It never shrinks: inside the outer ScrollView, content taller than the
 * window has to keep its own height and scroll, and `flex: 1`'s zero basis
 * would squeeze it into the viewport instead.
 */
const takesSlack: ViewStyle = { flexGrow: 1, flexShrink: 0, flexBasis: 'auto' };

export { CONTENT_H_PAD, MENU_MAX_W, takesSlack };

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
