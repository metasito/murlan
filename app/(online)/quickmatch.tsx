import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Platform,
  BackHandler,
  useWindowDimensions,
  ActivityIndicator,
} from "react-native";
import { router, useNavigation } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useOnlineGame } from "@/context/OnlineGameContext";
import Colors from "@/constants/colors";
import { MenuLayout } from "@/components/MenuLayout";
import { MenuCard } from "@/components/MenuCard";
import { MenuButton } from "@/components/MenuButton";

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
    desc: "Quattro, tutti contro tutti",
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
  const { width: W, height: H } = useWindowDimensions();
  const { quickmatch, leaveRoom, room, error, clearError } = useOnlineGame();
  const navigation = useNavigation();

  const [phase, setPhase] = useState<"selecting" | "searching">("selecting");
  const [selectedMode, setSelectedMode] = useState<ModeOption | null>(null);
  const [dotCount, setDotCount] = useState(0);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const isLandscape = W > H;

  useEffect(() => {
    if (room) {
      router.replace("/(online)/room");
    }
  }, [room?.roomId]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (phase === "searching") {
        handleCancelSearch();
      } else {
        const parent = navigation.getParent();
        if (parent) parent.goBack();
        else navigation.goBack();
      }
      return true;
    });
    return () => sub.remove();
  }, [phase]);

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
    const parent = navigation.getParent();
    if (parent) parent.goBack();
    else navigation.goBack();
  };

  const dots = ".".repeat(dotCount) + "\u00A0".repeat(3 - dotCount);

  if (phase === "selecting") {
    const cardW = isLandscape
      ? Math.floor((W - insets.left - insets.right - 40 - 36) / 4)
      : Math.floor((Math.min(W, 500) - 40 - 12) / 2);

    return (
      <MenuLayout scrollable={true} centered={false} style={{ justifyContent: "space-between" }}>
        {!isLandscape && (
          <View style={styles.header}>
            <Ionicons name="earth-outline" size={28} color={Colors.gold} />
            <Text style={styles.headerTitle}>Online</Text>
            <Text style={styles.headerSub}>Scegli il formato di gioco</Text>
          </View>
        )}

        {isLandscape && (
          <View style={styles.landscapeHeader}>
            <Ionicons name="earth-outline" size={20} color={Colors.gold} />
            <Text style={styles.landscapeHeaderText}>Scegli il formato</Text>
          </View>
        )}

        <View style={[
          styles.modeCardsRow,
          isLandscape && styles.modeCardsRowLandscape,
        ]}>
          {MODES.map((mode) => (
            <Pressable
              key={`${mode.maxPlayers}-${mode.gameMode}`}
              style={({ pressed }) => [
                styles.modeCard,
                { width: cardW },
                isLandscape && styles.modeCardLandscape,
                pressed && styles.modeCardPressed,
              ]}
              onPress={() => handleSelectMode(mode)}
            >
              <View style={styles.modeIconRow}>
                <View style={[styles.modeIconBg, isLandscape && styles.modeIconBgSmall]}>
                  <Ionicons name={mode.icon} size={isLandscape ? 20 : 26} color={Colors.gold} />
                </View>
                <View style={styles.playerBadge}>
                  <Text style={styles.playerBadgeText}>{mode.playerLabel}</Text>
                </View>
              </View>
              <Text style={[styles.modeLabel, isLandscape && styles.modeLabelSmall]}>{mode.label}</Text>
              <Text style={styles.modeDesc}>{mode.desc}</Text>
            </Pressable>
          ))}
        </View>

        <MenuButton
          label="Indietro"
          onPress={handleCancelHome}
          variant="ghost"
          fullWidth={false}
          style={styles.cancelBtnStyle}
        />
      </MenuLayout>
    );
  }

  return (
    <MenuLayout scrollable={false} centered={true}>
      <View style={[styles.searchContent, isLandscape && styles.searchContentLandscape]}>
        <Animated.View style={[
          styles.globeWrapper,
          { transform: [{ scale: pulseAnim }] },
          isLandscape && { marginBottom: 0 },
        ]}>
          <View style={[styles.globeCircle, isLandscape && styles.globeCircleSmall]}>
            <Ionicons name="earth-outline" size={isLandscape ? 36 : 64} color={Colors.gold} />
          </View>
        </Animated.View>

        <MenuCard style={styles.searchCard}>
          {selectedMode && (
            <View style={styles.selectedModeTag}>
              <Ionicons name={selectedMode.icon} size={14} color={Colors.gold} />
              <Text style={styles.selectedModeText}>{selectedMode.label}</Text>
            </View>
          )}

          {error ? (
            <>
              <Text style={styles.errorText}>{error}</Text>
              <MenuButton label="Riprova" onPress={handleRetry} />
            </>
          ) : (
            <>
              <ActivityIndicator color={Colors.gold} size="small" style={{ marginBottom: 8 }} />
              <Text style={styles.searchingLabel}>
                Cerco giocatori<Text style={styles.dots}>{dots}</Text>
              </Text>
              <Text style={styles.subtitle}>Ti uniremo a una partita appena possibile</Text>
            </>
          )}
        </MenuCard>
      </View>

      <MenuButton
        label="Annulla"
        onPress={handleCancelSearch}
        variant="ghost"
        fullWidth={false}
        style={styles.cancelBtnStyle}
      />
    </MenuLayout>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    paddingBottom: 4,
    gap: 4,
  },
  headerTitle: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 26,
    color: Colors.gold,
    letterSpacing: 1,
  },
  headerSub: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 2,
  },
  landscapeHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
    alignSelf: "center",
  },
  landscapeHeaderText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 16,
    color: Colors.gold,
    letterSpacing: 1,
  },
  modeCardsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 12,
    marginVertical: 16,
  },
  modeCardsRowLandscape: {
    flexWrap: "nowrap",
    gap: 10,
  },
  modeCard: {
    backgroundColor: Colors.felt,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "rgba(201,168,76,0.25)",
    padding: 18,
    alignItems: "center",
    gap: 8,
  },
  modeCardLandscape: {
    padding: 10,
    gap: 5,
    borderRadius: 12,
  },
  modeCardPressed: {
    borderColor: Colors.gold,
    backgroundColor: "#0d4a2e",
  },
  modeIconRow: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  modeIconBg: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(201,168,76,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  modeIconBgSmall: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  playerBadge: {
    position: "absolute",
    top: -4,
    right: -8,
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
    fontFamily: "Rajdhani_700Bold",
    fontSize: 18,
    color: Colors.text,
    letterSpacing: 0.3,
    textAlign: "center",
  },
  modeLabelSmall: { fontSize: 14 },
  modeDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: Colors.textMuted,
    textAlign: "center",
    lineHeight: 15,
  },
  cancelBtnStyle: {
    alignSelf: "center",
    paddingHorizontal: 40,
  },
  searchContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    paddingHorizontal: 16,
    width: "100%",
  },
  searchContentLandscape: {
    flexDirection: "row",
    gap: 28,
  },
  globeWrapper: {
    marginBottom: 8,
  },
  globeCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: Colors.felt,
    borderWidth: 2,
    borderColor: Colors.gold,
    alignItems: "center",
    justifyContent: "center",
  },
  globeCircleSmall: {
    width: 76,
    height: 76,
    borderRadius: 38,
  },
  searchCard: {
    minHeight: 120,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    maxWidth: 320,
    marginBottom: 0,
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
    marginBottom: 8,
  },
  selectedModeText: {
    fontFamily: "Rajdhani_600SemiBold",
    color: Colors.gold,
    fontSize: 13,
  },
  searchingLabel: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 22,
    color: Colors.gold,
    letterSpacing: 0.5,
    textAlign: "center",
  },
  dots: {
    color: Colors.gold,
    fontFamily: "Rajdhani_700Bold",
  },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: "center",
    lineHeight: 20,
    marginTop: 4,
  },
  errorText: {
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    color: "#e57373",
    textAlign: "center",
    marginBottom: 4,
  },
});
