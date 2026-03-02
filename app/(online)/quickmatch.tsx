import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useOnlineGame } from "@/context/OnlineGameContext";
import Colors from "@/constants/colors";

export default function QuickmatchScreen() {
  const insets = useSafeAreaInsets();
  const { quickmatch, leaveRoom, room, error, clearError } = useOnlineGame();

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const [dotCount, setDotCount] = useState(0);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  // Start searching on mount
  useEffect(() => {
    quickmatch();
  }, []);

  // Navigate to room when assigned
  useEffect(() => {
    if (room) {
      router.replace("/(online)/room");
    }
  }, [room?.roomId]);

  // Pulsing globe animation
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  // Dots animation (0→3) using interval
  useEffect(() => {
    const id = setInterval(() => {
      setDotCount((d) => (d + 1) % 4);
    }, 500);
    return () => clearInterval(id);
  }, []);

  const handleRetry = () => {
    clearError();
    quickmatch();
  };

  const handleCancel = () => {
    leaveRoom();
    router.replace("/");
  };

  const dots = ".".repeat(dotCount) + "\u00A0".repeat(3 - dotCount);

  return (
    <View style={[styles.container, { paddingTop: topPad, paddingBottom: bottomPad }]}>
      <View style={styles.content}>
        <Animated.View style={[styles.globeWrapper, { transform: [{ scale: pulseAnim }] }]}>
          <View style={styles.globeCircle}>
            <Ionicons name="earth-outline" size={64} color={Colors.gold} />
          </View>
        </Animated.View>

        {error ? (
          <>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.retryBtn} onPress={handleRetry}>
              <Text style={styles.retryText}>Riprova</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.searchingLabel}>
              Cerco giocatori<Text style={styles.dots}>{dots}</Text>
            </Text>
            <Text style={styles.subtitle}>Ti uniremo a una partita appena possibile</Text>
          </>
        )}
      </View>

      <Pressable style={styles.cancelBtn} onPress={handleCancel}>
        <Text style={styles.cancelText}>Annulla</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
    alignItems: "center",
    justifyContent: "space-between",
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    paddingHorizontal: 32,
  },
  globeWrapper: {
    marginBottom: 8,
  },
  globeCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "#0B3B25",
    borderWidth: 2,
    borderColor: Colors.gold,
    alignItems: "center",
    justifyContent: "center",
  },
  searchingLabel: {
    fontSize: 22,
    fontWeight: "700",
    color: Colors.gold,
    letterSpacing: 0.5,
  },
  dots: {
    color: Colors.gold,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 14,
    color: "rgba(255,255,255,0.5)",
    textAlign: "center",
    lineHeight: 20,
  },
  errorText: {
    fontSize: 15,
    color: "#e57373",
    textAlign: "center",
    marginBottom: 4,
  },
  retryBtn: {
    backgroundColor: Colors.gold,
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 12,
  },
  retryText: {
    color: "#031008",
    fontSize: 16,
    fontWeight: "700",
  },
  cancelBtn: {
    marginBottom: 16,
    paddingVertical: 14,
    paddingHorizontal: 40,
  },
  cancelText: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 16,
    fontWeight: "600",
  },
});
