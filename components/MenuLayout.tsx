import React from 'react';
import {
  View, ScrollView, StyleSheet, ViewStyle, KeyboardAvoidingView,
} from 'react-native';
import Animated, {
  cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/lib/theme';
import { keyboardBehavior } from '@/lib/keyboard';
import { a11yHidden } from '@/lib/a11y';
import { usePrefersReducedMotion } from '@/lib/accessibility';
import { useBannerBottom } from '@/context/NotificationContext';
import { SLIDE_DURATION, TOP_GAP } from '@/components/NotificationBanner';

const BACKDROP = [Colors.bg, Colors.bg, Colors.feltDark] as const;

const CONTENT_H_PAD = 20;
// Tall enough to read as the page continuing rather than as a shadow, short
// enough not to wash out the last line of content.
const MORE_BELOW_H = 56;
const SCROLL_THROTTLE_MS = 16;
// The app is served as a web bundle, so a 1920-wide browser is a real viewport
// and an uncapped menu row puts its two ends a metre apart.
const MENU_MAX_W = 800;

/**
 * A style whose `paddingTop` is `base + target`, reached over `duration` rather
 * than in a single frame.
 *
 * The base is inside the worklet rather than in a static style underneath it:
 * a padding written from the UI thread wins over the one React rendered, so a
 * static `paddingTop` sibling would be whatever the first frame overwrites.
 *
 * A layout transition is not the answer here — reanimated implements one on web
 * as a FLIP, scaling the whole subtree for its duration.
 *
 * Starts settled: a screen mounted while a banner is already up has nothing to
 * animate, and sliding its content down on arrival would be a second movement
 * nobody asked for.
 */
function useEasedPadTop(base: number, target: number, fullDuration: number) {
  const reserved = useSharedValue(target);
  const reduceMotion = usePrefersReducedMotion();
  const duration = reduceMotion ? 0 : fullDuration;

  React.useEffect(() => {
    reserved.value = withTiming(target, { duration, easing: Easing.out(Easing.cubic) });
    // A screen left mid-slide otherwise keeps ticking on the UI thread against
    // a shared value whose view is already gone.
    return () => cancelAnimation(reserved);
  }, [target, duration, reserved]);

  return useAnimatedStyle(() => ({ paddingTop: base + reserved.value }));
}

interface MenuLayoutProps {
  children: React.ReactNode;
  scrollable?: boolean;
  centered?: boolean;
  /**
   * The top pad is not a caller's to set: it carries the banner reservation and
   * is written from the UI thread, so a value here would be dropped on the first
   * frame with nothing to say so. Stated as a type rather than in a comment,
   * because the `paddingBottom: 0` three screens already pass is exactly the
   * gesture someone copies upward.
   */
  style?: Omit<ViewStyle, 'padding' | 'paddingVertical' | 'paddingTop'>;
  contentPad?: number;
  /** `null` opts a screen out — for the landscape bodies that size their own columns. */
  maxWidth?: number | null;
  /**
   * `false` for a screen whose only text field lives in a `<Modal>`: the modal
   * brings its own avoidance, and this one would move the screen behind it.
   */
  avoidsKeyboard?: boolean;
}

export function MenuLayout({
  children,
  scrollable = true,
  centered = true,
  style,
  contentPad = CONTENT_H_PAD,
  maxWidth = MENU_MAX_W,
  avoidsKeyboard = true,
}: MenuLayoutProps) {
  const insets = useSafeAreaInsets();
  const bannerBottom = useBannerBottom();

  const [viewportH, setViewportH] = React.useState(0);
  const [contentH,  setContentH]  = React.useState(0);
  const [offsetY,   setOffsetY]   = React.useState(0);
  // Half the fade's own height: less than that left to travel and the hint is
  // covering the end of the content rather than pointing past it.
  const hasMore = contentH - offsetY - viewportH > MORE_BELOW_H / 2;

  const paddingTop    = Math.max(insets.top, contentPad);
  const paddingBottom = Math.max(insets.bottom, contentPad);
  const paddingLeft   = insets.left  + contentPad;
  const paddingRight  = insets.right + contentPad;

  // A banner floats over the navigator at a z-index above it, so nothing here
  // is told it is there and the screen would otherwise lay itself out under it.
  // Eased on the banner's own step, so the content moves with it rather than
  // jumping clear a third of a second before it arrives.
  const padTopStyle = useEasedPadTop(
    paddingTop,
    Math.max(0, bannerBottom + TOP_GAP - paddingTop),
    SLIDE_DURATION
  );

  // `style` is merged after `centered` so callers can override layout — e.g.
  // justifyContent — without it being clobbered by the centered preset. Its type
  // has no top pad in it, which is the only reason `padTopStyle` can sit last.
  const contentStyle = [
    styles.bounded,
    { maxWidth: maxWidth ?? undefined },
    { paddingBottom, paddingLeft, paddingRight },
    centered && styles.centered,
    style,
    padTopStyle,
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
      {/* Only the scrollable branch below carries
          `automaticallyAdjustKeyboardInsets`, so only it can be left to move
          the focused field on its own. */}
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={
          avoidsKeyboard ? keyboardBehavior({ contentAdjustsInsets: scrollable }) : undefined
        }
      >
        {scrollable ? (
          <View style={styles.fill}>
            <ScrollView
              style={styles.fill}
              contentContainerStyle={styles.scroll}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets
              showsVerticalScrollIndicator={false}
              scrollEventThrottle={SCROLL_THROTTLE_MS}
              onLayout={(e) => setViewportH(e.nativeEvent.layout.height)}
              onContentSizeChange={(_w, h) => setContentH(h)}
              onScroll={(e) => setOffsetY(e.nativeEvent.contentOffset.y)}
            >
              <Animated.View testID="menu-content" style={contentStyle}>{children}</Animated.View>
            </ScrollView>
            {/* A screen taller than its window otherwise ends flush at the
                bottom edge and reads as finished — /rules is 240% of a phone
                (#587). The platforms' own indicators do not answer it: they
                appear once you already scroll, which is the thing being
                decided against. */}
            {hasMore && (
              <LinearGradient
                testID="menu-more-below"
                colors={[Colors.bgClear, Colors.bg]}
                style={styles.moreBelow}
                pointerEvents="none"
                {...a11yHidden()}
              />
            )}
          </View>
        ) : (
          <View style={styles.fill}>
            <Animated.View testID="menu-content" style={contentStyle}>{children}</Animated.View>
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
  moreBelow: { position: 'absolute', left: 0, right: 0, bottom: 0, height: MORE_BELOW_H },
});
