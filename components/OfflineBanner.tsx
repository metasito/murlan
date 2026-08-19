import React, { useEffect, useRef, useState } from "react";
import { Text, StyleSheet } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { Colors, Type, Motion, Shadow } from "@/lib/theme";
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
        duration: reduceMotion ? 0 : Motion.duration.moderate,
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
      <Text style={styles.text}>{t("offlineBanner.text")}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10000,
    height: BANNER_H,
    backgroundColor: Colors.danger,
    alignItems: "center",
    justifyContent: "center",
    ...Shadow.raised,
  },
  text: { ...Type.body, color: Colors.white },
});
