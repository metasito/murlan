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

const BANNER_H = 44;

export function OfflineBanner() {
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
  }, [reduceMotion]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  // Always rendered — animation controls visibility
  return (
    <Animated.View
      style={[styles.banner, { pointerEvents: "none" as const }, animStyle]}
      accessibilityRole="alert"
      accessibilityLiveRegion={isOffline ? "assertive" : "none"}
      accessibilityElementsHidden={!isOffline}
      importantForAccessibility={isOffline ? "yes" : "no-hide-descendants"}
    >
      <Text style={styles.text}>⚠️ Nessuna connessione Internet</Text>
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
