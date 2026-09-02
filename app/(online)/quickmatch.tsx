import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  BackHandler,
  ActivityIndicator,
} from "react-native";
import { useOrientedWindow } from "@/lib/orientation";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { router, useNavigation } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useOnlineConnection, useOnlineRoom } from "@/context/onlineGameHooks";
import { Colors, FontSize, Motion, Radius, Spacing } from '@/lib/theme';
import { MenuLayout, CONTENT_H_PAD } from "@/components/MenuLayout";
import { MenuCard } from "@/components/MenuCard";
import { MenuButton } from "@/components/MenuButton";
import { useTranslation } from "@/lib/i18n";
import type { GameMode } from "@/lib/gameEngine";
import { usePrefersReducedMotion } from "@/lib/accessibility";

interface ModeOption {
  maxPlayers: number;
  gameMode: GameMode;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  desc: string;
  playerLabel: string;
}

// Built with the current `t` on every render (see useModes below) rather
// than frozen at import time, so the mode cards follow a live language
// change with no app restart.
function buildModes(t: ReturnType<typeof useTranslation>["t"]): ModeOption[] {
  return [
    {
      maxPlayers: 2,
      gameMode: "free_for_all",
      icon: "person-outline",
      label: t("quickmatch.mode1v1Label"),
      desc: t("quickmatch.mode1v1Desc"),
      playerLabel: "2",
    },
    {
      maxPlayers: 3,
      gameMode: "free_for_all",
      icon: "people-outline",
      label: t("quickmatch.modeTrioLabel"),
      desc: t("quickmatch.modeTrioDesc"),
      playerLabel: "3",
    },
    {
      maxPlayers: 4,
      gameMode: "free_for_all",
      icon: "apps-outline",
      label: t("quickmatch.mode4FreeLabel"),
      desc: t("quickmatch.mode4FreeDesc"),
      playerLabel: "4",
    },
    {
      maxPlayers: 4,
      gameMode: "teams",
      icon: "shield-half-outline",
      label: t("quickmatch.mode2v2Label"),
      desc: t("quickmatch.mode2v2Desc"),
      playerLabel: "4",
    },
  ];
}

export default function QuickmatchScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const MODES = React.useMemo(() => buildModes(t), [t]);
  const { width: W, height: H } = useOrientedWindow();
  const { quickmatch, leaveRoom, room } = useOnlineRoom();
  const { error, clearError } = useOnlineConnection();
  const navigation = useNavigation();

  const [phase, setPhase] = useState<"selecting" | "searching">("selecting");
  const [selectedMode, setSelectedMode] = useState<ModeOption | null>(null);
  const [dotCount, setDotCount] = useState(0);
  const pulse = useSharedValue(1);
  const reduceMotion = usePrefersReducedMotion();

  const isLandscape = W > H;

  // The id, not the room: every field update would otherwise replace the route again.
  const roomId = room?.roomId;
  useEffect(() => {
    if (roomId) {
      router.replace("/(online)/room");
    }
  }, [roomId]);

  const handleCancelSearch = React.useCallback(() => {
    leaveRoom();
    clearError();
    setPhase("selecting");
    setSelectedMode(null);
  }, [leaveRoom, clearError]);

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
  }, [phase, handleCancelSearch, navigation]);

  useEffect(() => {
    if (phase !== "searching" || reduceMotion) {
      pulse.value = 1;
      return;
    }
    const breath = (to: number) =>
      withTiming(to, { duration: Motion.duration.dwell, easing: Easing.inOut(Easing.sin) });
    pulse.value = withRepeat(withSequence(breath(1.15), breath(1)), -1, false);
  }, [phase, pulse, reduceMotion]);

  // After the effect above, not before it: reading a shared value here freezes
  // it for the React Compiler, and the assignment then bails the whole file.
  const pulseAnim = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

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

  const handleCancelHome = () => {
    const parent = navigation.getParent();
    if (parent) parent.goBack();
    else navigation.goBack();
  };

  const dots = ".".repeat(dotCount) + "\u00A0".repeat(3 - dotCount);

  if (phase === "selecting") {
    const hPad = insets.left + insets.right + 2 * CONTENT_H_PAD;
    const availW = W - hPad;
    const cardW = isLandscape
      ? Math.floor((availW - 3 * 10) / 4)
      : Math.floor((Math.min(availW, 460) - 12) / 2);

    return (
      <MenuLayout scrollable={true} centered={false} style={{ justifyContent: "space-between" }}>
        {!isLandscape && (
          <View style={styles.header}>
            <Ionicons name="earth-outline" size={28} color={Colors.gold} />
            <Text style={styles.headerTitle}>{t("quickmatch.title")}</Text>
            <Text style={styles.headerSub}>{t("quickmatch.subtitle")}</Text>
          </View>
        )}

        {isLandscape && (
          <View style={styles.landscapeHeader}>
            <Ionicons name="earth-outline" size={20} color={Colors.gold} />
            <Text style={styles.landscapeHeaderText}>{t("quickmatch.subtitleShort")}</Text>
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
          label={t("common.back")}
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
          pulseAnim,
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
              <MenuButton label={t("common.retry")} onPress={handleRetry} />
            </>
          ) : (
            <>
              <ActivityIndicator color={Colors.gold} size="small" style={{ marginBottom: Spacing.sm }} />
              <Text style={styles.searchingLabel}>
                {t("quickmatch.searching")}<Text style={styles.dots}>{dots}</Text>
              </Text>
              <Text style={styles.subtitle}>{t("quickmatch.searchingSubtitle")}</Text>
            </>
          )}
        </MenuCard>
      </View>

      <MenuButton
        label={t("common.cancel")}
        onPress={handleCancelSearch}
        variant="ghost"
        fullWidth={false}
        style={styles.cancelBtnStyle}
      />
    </MenuLayout>
  );
}

const LANDSCAPE_GAP = 28;

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    paddingBottom: Spacing.xs,
    gap: Spacing.xs,
  },
  headerTitle: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.xl,
    color: Colors.gold,
    letterSpacing: 1,
  },
  headerSub: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    marginTop: Spacing.xxs,
  },
  landscapeHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.snug,
    alignSelf: "center",
  },
  landscapeHeaderText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: FontSize.md,
    color: Colors.gold,
    letterSpacing: 1,
  },
  modeCardsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: Spacing.cosy,
    marginVertical: Spacing.md,
  },
  modeCardsRowLandscape: {
    flexWrap: "nowrap",
    gap: Spacing.snug,
  },
  modeCard: {
    backgroundColor: Colors.felt,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.goldBorder,
    padding: Spacing.md,
    alignItems: "center",
    gap: Spacing.sm,
  },
  modeCardLandscape: {
    padding: Spacing.snug,
    gap: Spacing.xs,
    borderRadius: Radius.md,
  },
  modeCardPressed: {
    borderColor: Colors.gold,
    backgroundColor: Colors.feltLight,
  },
  modeIconRow: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xxs,
  },
  modeIconBg: {
    width: 52,
    height: 52,
    borderRadius: Radius.full,
    backgroundColor: Colors.goldMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  modeIconBgSmall: {
    width: 38,
    height: 38,
    borderRadius: Radius.full,
  },
  playerBadge: {
    position: "absolute",
    top: -4,
    right: -8,
    backgroundColor: Colors.gold,
    borderRadius: Radius.full,
    minWidth: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xs,
  },
  playerBadgeText: {
    color: Colors.bg,
    fontSize: FontSize.xs,
    fontWeight: "800",
  },
  modeLabel: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.lg,
    color: Colors.text,
    letterSpacing: 0.3,
    textAlign: "center",
  },
  modeLabelSmall: { fontSize: FontSize.sm },
  modeDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    textAlign: "center",
    lineHeight: 15,
  },
  cancelBtnStyle: {
    alignSelf: "center",
    paddingHorizontal: Spacing.xxl,
  },
  searchContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.roomy,
    paddingHorizontal: Spacing.md,
    width: "100%",
  },
  searchContentLandscape: {
    flexDirection: "row",
    gap: LANDSCAPE_GAP,
  },
  globeWrapper: {
    marginBottom: Spacing.sm,
  },
  globeCircle: {
    width: 120,
    height: 120,
    borderRadius: Radius.full,
    backgroundColor: Colors.felt,
    borderWidth: 2,
    borderColor: Colors.gold,
    alignItems: "center",
    justifyContent: "center",
  },
  globeCircleSmall: {
    width: 76,
    height: 76,
    borderRadius: Radius.full,
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
    gap: Spacing.slim,
    backgroundColor: Colors.goldMuted,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.wide,
    paddingVertical: Spacing.slim,
    borderWidth: 1,
    borderColor: Colors.goldBorder,
    marginBottom: Spacing.sm,
  },
  selectedModeText: {
    fontFamily: "Rajdhani_600SemiBold",
    color: Colors.gold,
    fontSize: FontSize.sm,
  },
  searchingLabel: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.xl,
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
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    textAlign: "center",
    lineHeight: 20,
    marginTop: Spacing.xs,
  },
  errorText: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.md,
    color: Colors.dangerDim,
    textAlign: "center",
    marginBottom: Spacing.xs,
  },
});
