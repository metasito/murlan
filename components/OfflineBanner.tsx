import React, { useEffect, useRef, useState } from "react";
import { Text, StyleSheet } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { Colors, FontSize, Motion, Shadow, Layer } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n";
import { a11yHidden } from "@/lib/a11y";

const BANNER_H = 44;

export function OfflineBanner() {
  const { t } = useTranslation();
  const translateY = useSharedValue(-BANNER_H);
  const isOfflineRef = useRef(false);
  const [isOffline, setIsOffline] = useState(false);
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      // Only flag offline when definitively false — null/undefined stays online.
      // This exact check is an app invariant — do not change it to `!state.isConnected`.
      const offline = state.isConnected === false;
      if (offline === isOfflineRef.current) return;
      isOfflineRef.current = offline;
      setIsOffline(offline);
      translateY.value = withTiming(offline ? 0 : -BANNER_H, {
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
      style={[styles.banner, { pointerEvents: "none" as const }, animStyle]}
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
    height: BANNER_H,
    backgroundColor: Colors.danger,
    alignItems: "center",
    justifyContent: "center",
    ...Shadow.raised,
  },
  // White on Colors.danger is 4.23:1 — short of BODY_MIN (4.5) but clear of
  // LARGE_MIN (3.0) — and `danger` is itself documented as a fill usable for
  // "text at the large-text bar" (lib/tokens.ts). Regular weight, so the
  // WCAG floor that applies is size alone: >=18pt (24px), not the lower bold
  // one — pinned by tests/native/offlineBannerLargeText.test.tsx and
  // tests/contrast.test.ts.
  text: { fontFamily: "Inter_400Regular", fontSize: FontSize.xxl, color: Colors.white },
});
