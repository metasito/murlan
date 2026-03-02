import React, { useEffect, useRef } from "react";
import { Text, StyleSheet, Platform } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";

const BANNER_H = 44;

export function OfflineBanner() {
  const translateY = useSharedValue(-BANNER_H);
  const isOfflineRef = useRef(false);

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      // Only flag offline when definitively false — treat null/undefined as online
      const offline = state.isConnected === false;
      if (offline === isOfflineRef.current) return;
      isOfflineRef.current = offline;
      translateY.value = withTiming(offline ? 0 : -BANNER_H, { duration: 300 });
    });
    return () => unsub();
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  // Always rendered — animation controls visibility
  return (
    <Animated.View style={[styles.banner, animStyle]} pointerEvents="none">
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
    backgroundColor: "#B71C1C",
    paddingVertical: 10,
    height: BANNER_H,
    alignItems: "center",
    justifyContent: "center",
    ...(Platform.OS === "web"
      ? ({ boxShadow: "0 2px 8px rgba(0,0,0,0.4)" } as any)
      : {
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.4,
          shadowRadius: 4,
          elevation: 10,
        }),
  },
  text: { color: "#fff", fontFamily: "Inter_400Regular", fontSize: 13 },
});
