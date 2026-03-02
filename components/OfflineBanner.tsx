import React, { useEffect, useState } from "react";
import { Text, StyleSheet, Platform } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";

export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);
  const translateY = useSharedValue(-44);

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      const offline = !(
        state.isConnected && state.isInternetReachable !== false
      );
      setIsOffline(offline);
      translateY.value = withTiming(offline ? 0 : -44, { duration: 300 });
    });
    return () => unsub();
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!isOffline) return null;

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
    alignItems: "center",
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
