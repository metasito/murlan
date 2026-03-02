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

type GameMode = "free_for_all" | "teams";

interface ModeOption {
  maxPlayers: number;
  gameMode: GameMode;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  desc: string;
  playerLabel: string;
}

const MODES: ModeOption[] = [
  {
    maxPlayers: 2,
    gameMode: "free_for_all",
    icon: "person-outline",
    label: "1 vs 1",
    desc: "Solo contro un avversario",
    playerLabel: "2",
  },
  {
    maxPlayers: 3,
    gameMode: "free_for_all",
    icon: "people-outline",
    label: "Trio",
    desc: "Tre giocatori liberi",
    playerLabel: "3",
  },
  {
    maxPlayers: 4,
    gameMode: "free_for_all",
    icon: "apps-outline",
    label: "4 Liberi",
    desc: "Quattro giocatori, tutti contro tutti",
    playerLabel: "4",
  },
  {
    maxPlayers: 4,
    gameMode: "teams",
    icon: "shield-half-outline",
    label: "2 vs 2",
    desc: "Due coppie in sfida",
    playerLabel: "4",
  },
];

export default function QuickmatchScreen() {
  const insets = useSafeAreaInsets();
  const { quickmatch, leaveRoom, room, error, clearError } = useOnlineGame();

  const [phase, setPhase] = useState<"selecting" | "searching">("selecting");
  const [selectedMode, setSelectedMode] = useState<ModeOption | null>(null);
  const [dotCount, setDotCount] = useState(0);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  // Navigate to room when assigned
  useEffect(() => {
    if (room) {
      router.replace("/(online)/room");
    }
  }, [room?.roomId]);

  // Pulsing globe animation (only while searching)
  useEffect(() => {
    if (phase !== "searching") return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [phase]);

  // Dots animation (only while searching)
  useEffect(() => {
    if (phase !== "searching") return;
    const id = setInterval(() => {
      setDotCount((d) => (d + 1) % 4);
    }, 500);
    return () => clearInterval(id);
  }, [phase]);

  const handleSelectMode = (mode: ModeOption) => {
    setSelectedMode(mode);
    clearError();
    quickmatch(mode.maxPlayers, mode.gameMode);
    setPhase("searching");
  };

  const handleRetry = () => {
    if (!selectedMode) return;
    clearError();
    quickmatch(selectedMode.maxPlayers, selectedMode.gameMode);
  };

  const handleCancelSearch = () => {
    leaveRoom();
    clearError();
    setPhase("selecting");
    setSelectedMode(null);
  };

  const handleCancelHome = () => {
    router.replace("/");
  };

  const dots = ".".repeat(dotCount) + "\u00A0".repeat(3 - dotCount);

  if (phase === "selecting") {
    return (
      <View style={[styles.container, { paddingTop: topPad, paddingBottom: bottomPad }]}>
        <View style={styles.header}>
          <Ionicons name="earth-outline" size={32} color={Colors.gold} />
          <Text style={styles.headerTitle}>Online</Text>
          <Text style={styles.headerSub}>Scegli il formato di gioco</Text>
        </View>

        <View style={styles.modeGrid}>
          {MODES.map((mode) => (
            <Pressable
              key={`${mode.maxPlayers}-${mode.gameMode}`}
              style={({ pressed }) => [styles.modeCard, pressed && styles.modeCardPressed]}
              onPress={() => handleSelectMode(mode)}
            >
              <View style={styles.modeIconRow}>
                <View style={styles.modeIconBg}>
                  <Ionicons name={mode.icon} size={28} color={Colors.gold} />
                </View>
                <View style={styles.playerBadge}>
                  <Text style={styles.playerBadgeText}>{mode.playerLabel}</Text>
                </View>
              </View>
              <Text style={styles.modeLabel}>{mode.label}</Text>
              <Text style={styles.modeDesc}>{mode.desc}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable style={styles.cancelBtn} onPress={handleCancelHome}>
          <Text style={styles.cancelText}>Indietro</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: topPad, paddingBottom: bottomPad }]}>
      <View style={styles.content}>
        <Animated.View style={[styles.globeWrapper, { transform: [{ scale: pulseAnim }] }]}>
          <View style={styles.globeCircle}>
            <Ionicons name="earth-outline" size={64} color={Colors.gold} />
          </View>
        </Animated.View>

        {selectedMode && (
          <View style={styles.selectedModeTag}>
            <Ionicons name={selectedMode.icon} size={14} color={Colors.gold} />
            <Text style={styles.selectedModeText}>{selectedMode.label}</Text>
          </View>
        )}

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

      <Pressable style={styles.cancelBtn} onPress={handleCancelSearch}>
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
  header: {
    alignItems: "center",
    paddingTop: 24,
    gap: 6,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "700",
    color: Colors.gold,
    letterSpacing: 1,
  },
  headerSub: {
    fontSize: 14,
    color: "rgba(255,255,255,0.45)",
    marginTop: 2,
  },
  modeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 14,
    paddingHorizontal: 20,
    flex: 1,
    alignItems: "center",
  },
  modeCard: {
    width: "44%",
    backgroundColor: "#0B3B25",
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "rgba(201,168,76,0.25)",
    padding: 18,
    alignItems: "center",
    gap: 8,
  },
  modeCardPressed: {
    borderColor: Colors.gold,
    backgroundColor: "#0d4a2e",
  },
  modeIconRow: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  modeIconBg: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(201,168,76,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  playerBadge: {
    position: "absolute",
    top: -4,
    right: -10,
    backgroundColor: Colors.gold,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  playerBadgeText: {
    color: "#031008",
    fontSize: 11,
    fontWeight: "800",
  },
  modeLabel: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 0.3,
  },
  modeDesc: {
    fontSize: 11,
    color: "rgba(255,255,255,0.45)",
    textAlign: "center",
    lineHeight: 15,
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
  selectedModeTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(201,168,76,0.12)",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "rgba(201,168,76,0.3)",
  },
  selectedModeText: {
    color: Colors.gold,
    fontSize: 13,
    fontWeight: "600",
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
