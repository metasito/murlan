import React, { useEffect, useRef, useState } from "react";
import { Text, StyleSheet, type LayoutChangeEvent } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { Colors, Spacing, Motion, Shadow, Layer } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n";
import { a11yHidden } from "@/lib/a11y";

/** The band's floor height, for a locale whose text fits on one line. */
const BANNER_H = 44;
/**
 * How far offscreen the banner sits before its first layout pass reports a
 * real height. it-IT — the longest of the three strings — wraps to two lines
 * and measures ~71px at `BANNER_TEXT_SIZE`; this clears that with room for a
 * translation nobody has measured yet, so the banner never peeks at the top
 * of the screen before its own layout has run.
 */
const BANNER_OFFSCREEN_Y = -(BANNER_H * 3);
/**
 * WCAG's regular-weight large-text floor (18pt) — the smallest size that
 * clears it, not the largest. White on `Colors.danger` is 4.23:1, short of
 * the 4.5:1 body floor but clear of the 3:1 large-text one once the text
 * itself is large enough; `FontSize.xxl` (28) clears the same floor but
 * spends margin this banner cannot afford on its longer locales. Pinned by
 * tests/native/offlineBannerLargeText.test.tsx and tests/contrast.test.ts.
 */
const BANNER_TEXT_SIZE = 24;

export function OfflineBanner() {
  const { t } = useTranslation();
  const translateY = useSharedValue(BANNER_OFFSCREEN_Y);
  // The band has no fixed height (styles.banner) so a wrapped locale can grow
  // it; this is the real, measured height, read back so hiding the banner
  // clears all of it rather than the single-line guess above.
  const measuredHeight = useRef(BANNER_H);
  const isOfflineRef = useRef(false);
  const [isOffline, setIsOffline] = useState(false);
  const reduceMotion = usePrefersReducedMotion();

  // Declared before the effect below, not just above it in the file: moved
  // after, the React Compiler bails out on this component entirely
  // ("Modifying a value used previously in an effect function... is not
  // allowed") because `translateY` is also written here and listed as that
  // effect's dependency. `node scripts/react-compiler-probe.mjs
  // components/OfflineBanner.tsx` is how to check this again.
  const onLayout = (e: LayoutChangeEvent) => {
    measuredHeight.current = e.nativeEvent.layout.height;
    if (!isOfflineRef.current) translateY.value = -measuredHeight.current;
  };

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      // Only flag offline when definitively false — null/undefined stays online.
      // This exact check is an app invariant — do not change it to `!state.isConnected`.
      const offline = state.isConnected === false;
      if (offline === isOfflineRef.current) return;
      isOfflineRef.current = offline;
      setIsOffline(offline);
      translateY.value = withTiming(offline ? 0 : -measuredHeight.current, {
        duration: reduceMotion ? 0 : Motion.duration.travel,
      });
    });
    return () => unsub();
  }, [reduceMotion, translateY]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  // Always rendered — animation controls visibility
  return (
    <Animated.View
      testID="offline-banner"
      style={[styles.banner, { pointerEvents: "none" as const }, animStyle]}
      onLayout={onLayout}
      accessibilityRole="alert"
      accessibilityLiveRegion={isOffline ? "assertive" : "none"}
      {...a11yHidden(!isOffline)}
    >
      <Text testID="offline-banner-text" style={styles.text}>{t("offlineBanner.text")}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: Layer.alert,
    // No fixed height: a wrapped locale grows the band instead of spilling
    // past it. minHeight plus this padding reproduces the old single-line
    // BANNER_H exactly, so nothing moves for en/sq.
    minHeight: BANNER_H,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.danger,
    alignItems: "center",
    justifyContent: "center",
    ...Shadow.raised,
  },
  text: { fontFamily: "Inter_400Regular", fontSize: BANNER_TEXT_SIZE, color: Colors.white },
});
