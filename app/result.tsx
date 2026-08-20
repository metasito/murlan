import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Platform,
  useWindowDimensions,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  withSequence,
  withRepeat,
  Easing,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { hapticLight, hapticMedium, hapticSuccess } from "@/lib/haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useGame } from "@/context/GameContext";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { ResultExchangeOverlay, shouldShowResultExchange } from "@/components/ResultExchangeOverlay";
import { standings } from "@/lib/standings";
import { Colors, FontSize, Motion, Radius, Spacing, Type, WEB_BOTTOM_PAD, WEB_TOP_PAD } from '@/lib/theme';
import { useTranslation, type TranslationKey } from "@/lib/i18n";

const POSITION_COLORS = [Colors.podiumGold, Colors.podiumSilver, Colors.podiumBronze, Colors.textMuted];
// Shares its display text with components/GameOverOverlay.tsx's identical
// "1°"/"2°"/"3°"/"4°" position badges — same keys, one source of truth.
const POSITION_LABEL_KEYS: TranslationKey[] = [
  "gameOverOverlay.position1",
  "gameOverOverlay.position2",
  "gameOverOverlay.position3",
  "gameOverOverlay.position4",
];
const POSITION_ICONS = ["trophy", "medal", "ribbon", "remove-circle"] as const;

function ScoreRow({
  rank,
  name,
  totalScore,
  pointsEarned,
  isWinner,
  delay,
  team,
}: {
  rank: number;
  name: string;
  totalScore: number;
  pointsEarned: number;
  isWinner: boolean;
  delay: number;
  team?: "A" | "B";
}) {
  const { t } = useTranslation();
  const reduceMotion = usePrefersReducedMotion();
  const opacity = useSharedValue(0);
  const tx = useSharedValue(30);
  useEffect(() => {
    if (reduceMotion) {
      opacity.value = 1;
      tx.value = 0;
      return;
    }
    opacity.value = withDelay(delay, withTiming(1, { duration: 320 }));
    tx.value = withDelay(delay, withSpring(0, Motion.spring.entrance));
  }, [delay, opacity, reduceMotion, tx]);
  const anim = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: tx.value }],
  }));
  const color = POSITION_COLORS[rank] ?? Colors.textMuted;
  const icon = POSITION_ICONS[rank] ?? "person";
  const labelKey = POSITION_LABEL_KEYS[rank];
  const label = labelKey ? t(labelKey) : `${rank + 1}°`;

  return (
    <Animated.View style={[styles.rankCard, isWinner && styles.rankCardWinner, anim]}>
      {isWinner && (
        <LinearGradient
          colors={[Colors.goldMuted, "transparent"]}
          style={StyleSheet.absoluteFill}
        />
      )}
      <View style={[styles.posBadge, { borderColor: color }]}>
        <Text style={[styles.posLabel, { color }]}>{label}</Text>
      </View>
      <Ionicons
        name={icon as React.ComponentProps<typeof Ionicons>["name"]}
        size={16}
        color={color}
      />
      <View style={{ flex: 1 }}>
        <Text style={styles.playerName} numberOfLines={1}>{name}</Text>
        {team && (
          <Text style={[styles.teamLabel, { color: team === "A" ? Colors.accent : Colors.gold }]}>
            {t("lobby.team", { team })}
          </Text>
        )}
      </View>
      <View style={styles.scoreBlock}>
        <Text style={[styles.totalScore, isWinner && styles.totalScoreWinner]}>
          {totalScore}
        </Text>
        <Text style={styles.scoreSub}>{t("result.pointsDelta", { n: pointsEarned })}</Text>
      </View>
    </Animated.View>
  );
}

function WinnerCelebration({
  name,
  subtitle,
  compact,
}: {
  name: string;
  subtitle?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const reduceMotion = usePrefersReducedMotion();
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);
  const glow = useSharedValue(0.5);
  const glowScale = useSharedValue(1.0);
  // The verdict lands once. Kept off the motion effect below, which re-runs
  // when `usePrefersReducedMotion` settles asynchronously after first paint.
  useEffect(() => {
    hapticSuccess();
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      // The entrance and the endless glow behind it are the parts with nothing
      // to say; the result itself still arrives.
      scale.value = 1;
      opacity.value = 1;
      return;
    }
    scale.value = withSpring(1, Motion.spring.reveal);
    opacity.value = withTiming(1, { duration: 600 });
    glow.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.5, { duration: 1200, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      false
    );
    glowScale.value = withRepeat(
      withSequence(
        withTiming(1.15, { duration: 1200, easing: Easing.inOut(Easing.sin) }),
        withTiming(1.0, { duration: 1200, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      false
    );
  }, [glow, glowScale, opacity, reduceMotion, scale]);
  const containerAnim = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));
  const glowAnim = useAnimatedStyle(() => ({
    opacity: glow.value,
    transform: [{ scale: glowScale.value }],
  }));
  const trophySize = compact ? 56 : 72;
  const iconSize = compact ? 28 : 36;

  return (
    <Animated.View style={[styles.celebration, compact && styles.celebrationCompact, containerAnim]}>
      <Animated.View style={[styles.celebGlow, compact && styles.celebGlowCompact, glowAnim]} />
      <View style={[styles.trophyCircle, { width: trophySize, height: trophySize, borderRadius: trophySize / 2 }]}>
        <LinearGradient
          colors={[Colors.gold, Colors.goldDark]}
          style={styles.trophyGrad}
        >
          <Ionicons name="trophy" size={iconSize} color={Colors.bgCard} />
        </LinearGradient>
      </View>
      <Text style={[styles.winnerName, compact && styles.winnerNameCompact]} numberOfLines={1}>{name}</Text>
      <Text style={styles.winnerSub}>{subtitle ?? t("result.winnerDefault")}</Text>
    </Animated.View>
  );
}

export default function ResultScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { width: W, height: H } = useWindowDimensions();
  const isLandscape = W > H;
  const {
    gameState,
    match,
    tableWantsRematch,
    startNextHand,
    startNewMatch,
    chooseExchangeCard,
    resetGame,
  } = useGame();
  const prevExchangeActiveRef = useRef<boolean | undefined>(undefined);

  const isActive = gameState?.exchangePhase?.active;
  const bothJokers = gameState?.exchangePhase?.bothJokersException;

  useEffect(() => {
    if (isActive === undefined) return;
    const wasActive = prevExchangeActiveRef.current;
    if (wasActive === true && isActive === false && !bothJokers) {
      router.replace("/game");
    }
    prevExchangeActiveRef.current = isActive;
  }, [isActive, bothJokers]);

  useEffect(() => {
    if (!gameState) router.replace("/");
  }, [gameState]);

  if (!gameState) return null;

  const showExchange = shouldShowResultExchange(gameState);
  const numPlayers = gameState.players.length;
  const isTeamMode = gameState.gameMode === "teams";
  const isSingleHand = match.length === "single";

  // Scores are folded into the match by GameContext the moment the manche
  // ends, so this screen only reads them.
  const lastHand = match.hands[match.hands.length - 1];
  const handPoints = lastHand?.pointsAwarded ?? {};
  const finishOrder = lastHand?.rankings ?? [];
  const rows = standings(
    gameState.players.map((player) => {
      const at = finishOrder.indexOf(player.id);
      return {
        player,
        total: match.scores[player.id] ?? 0,
        points: handPoints[player.id] ?? 0,
        // A seat absent from the manche's order sorts last among equals.
        finishedAt: at === -1 ? finishOrder.length : at,
      };
    })
  );

  const nameOf = (playerId: string) =>
    gameState.players.find((p) => p.id === playerId)?.name ?? playerId;
  const teamOf = (playerId: string) =>
    gameState.players.find((p) => p.id === playerId)?.team;

  const handWinnerId = lastHand?.rankings[0];
  const matchWinnerId = match.winners[0];
  const celebratedId = (match.over ? matchWinnerId : handWinnerId) ?? rows[0]?.player.id;
  const celebratedTeam = celebratedId ? teamOf(celebratedId) : undefined;
  const celebratedName =
    isTeamMode && celebratedTeam
      ? t("lobby.team", { team: celebratedTeam })
      : celebratedId
        ? nameOf(celebratedId)
        : "";

  const headerTitle = match.over
    ? match.isDraw
      ? t("result.matchDrawTitle")
      : t("result.matchOverTitle")
    : t("result.handOverTitle");
  const formatLine = isSingleHand
    ? t("result.singleHandFormat")
    : t("result.matchProgress", { target: match.target });
  const celebrationSubtitle = match.over
    ? match.isDraw
      ? t("result.matchDrawSubtitle")
      : t("result.matchWinner")
    : t("result.handWinner");

  const topPad = Platform.OS === "web" ? WEB_TOP_PAD : insets.top;
  const bottomPad = Platform.OS === "web" ? WEB_BOTTOM_PAD : insets.bottom;
  const leftPad = Platform.OS === "web" ? 0 : insets.left;
  const rightPad = Platform.OS === "web" ? 0 : insets.right;

  const handleNextHand = () => {
    hapticMedium();
    startNextHand();
    router.replace("/game");
  };
  const handleNewMatch = () => {
    hapticMedium();
    startNewMatch();
    router.replace("/game");
  };
  const handleHome = () => {
    hapticLight();
    resetGame();
    router.replace("/");
  };

  // The table was asked during the closing manche; a majority "no" ends it
  // here, so there is no button offering to overrule them.
  const continueAction = !match.over
    ? { label: t("result.nextHand"), icon: "play-forward" as const, onPress: handleNextHand, testID: "btn-prossima-manche" }
    : tableWantsRematch
      ? { label: t("result.newMatch"), icon: "refresh" as const, onPress: handleNewMatch, testID: "btn-nuova-partita" }
      : null;
  const verdictLine = match.over
    ? tableWantsRematch
      ? t("result.tableContinues")
      : t("result.tableStops")
    : null;

  const actionsBlock = (compact?: boolean) => (
    <View style={[styles.actions, compact && styles.actionsRow]}>
      <Pressable
        testID="btn-home"
        onPress={handleHome}
        style={[styles.homeBtn, compact && styles.homeBtnCompact]}
        accessibilityRole="button"
        accessibilityLabel={t("result.home")}
      >
        <Ionicons name="home" size={18} color={Colors.textSecondary} />
        {!compact && <Text style={styles.homeBtnText}>{t("result.home")}</Text>}
      </Pressable>
      {continueAction && (
        <Pressable
          testID={continueAction.testID}
          onPress={continueAction.onPress}
          style={[styles.rematchBtn, compact && styles.rematchBtnFlex]}
          accessibilityRole="button"
          accessibilityLabel={continueAction.label}
        >
          <LinearGradient colors={[Colors.gold, Colors.goldDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.rematchGrad, compact && styles.rematchGradCompact]}>
            <Ionicons name={continueAction.icon} size={18} color={Colors.bgCard} />
            <Text style={styles.rematchText}>{continueAction.label}</Text>
          </LinearGradient>
        </Pressable>
      )}
    </View>
  );

  const header = (
    <View style={styles.headerMulti}>
      <Text style={styles.headerTitle}>{headerTitle}</Text>
      <Text style={styles.headerFormat}>{formatLine}</Text>
    </View>
  );

  const rankRows = rows.map((row, idx) => (
    <ScoreRow
      key={row.player.id}
      rank={idx}
      name={row.player.name}
      totalScore={row.total}
      pointsEarned={row.points}
      isWinner={idx === 0}
      delay={idx * 70 + 150}
      team={isTeamMode ? row.player.team : undefined}
    />
  ));

  const statTiles = (iconSize: number) => (
    <>
      <View style={styles.statItem}>
        <Ionicons name="people" size={iconSize} color={Colors.gold} />
        <Text style={styles.statValue}>{numPlayers}</Text>
        <Text style={styles.statLabel}>{t("result.statPlayers")}</Text>
      </View>
      <View style={styles.statItem}>
        <Ionicons name="layers" size={iconSize} color={Colors.gold} />
        <Text style={styles.statValue}>{match.hands.length}</Text>
        <Text style={styles.statLabel}>{t("result.statHands")}</Text>
      </View>
      {!isSingleHand && (
        <View style={styles.statItem}>
          <Ionicons name="flag" size={iconSize} color={Colors.gold} />
          <Text style={styles.statValue}>{match.target}</Text>
          <Text style={styles.statLabel}>{t("result.statTarget")}</Text>
        </View>
      )}
    </>
  );

  if (isLandscape) {
    return (
      <View style={[styles.container, { paddingTop: topPad, paddingBottom: bottomPad, paddingLeft: leftPad, paddingRight: rightPad }]}>
        <LinearGradient colors={[Colors.bg, Colors.bgCard, Colors.bg]} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />

        <View style={[styles.header, styles.headerLandscape]}>{header}</View>

        <View style={styles.landscapeBody}>
          <View style={styles.landscapeLeft}>
            <WinnerCelebration name={celebratedName} subtitle={celebrationSubtitle} compact />
            <View style={styles.statsRowLandscape}>{statTiles(14)}</View>
            {verdictLine && <Text style={styles.verdictLine}>{verdictLine}</Text>}
            {actionsBlock(true)}
          </View>

          <View style={styles.landscapeRight}>
            <Text style={styles.sectionTitle}>{t("gameOverOverlay.rankingsTitle")}</Text>
            <ScrollView showsVerticalScrollIndicator={false} style={styles.landscapeRankScroll} contentContainerStyle={styles.landscapeRankList}>
              {rankRows}
            </ScrollView>
            <View style={styles.legend}>
              <Ionicons name="information-circle-outline" size={10} color={Colors.textMuted} />
              <Text style={styles.legendText}>
                {t("result.legend", { a: numPlayers - 1, b: numPlayers - 2 })}
              </Text>
            </View>
          </View>
        </View>

        {showExchange && gameState.exchangePhase && (
          <ResultExchangeOverlay gameState={gameState} chooseExchangeCard={chooseExchangeCard} />
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <LinearGradient colors={[Colors.bg, Colors.bgCard, Colors.bg]} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />

      <View style={styles.header}>{header}</View>

      <ScrollView
        contentContainerStyle={[styles.portraitScroll, { paddingBottom: bottomPad + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <WinnerCelebration name={celebratedName} subtitle={celebrationSubtitle} />
        <View style={styles.statsRow}>
          {statTiles(16)}
          <View style={styles.statItem}>
            <Ionicons name={isTeamMode ? "people-circle" : "person-circle"} size={16} color={Colors.gold} />
            <Text style={styles.statValue}>{isTeamMode ? t("gameOverOverlay.modeTeams") : t("gameOverOverlay.modeFreeForAll")}</Text>
            <Text style={styles.statLabel}>{t("result.statMode")}</Text>
          </View>
        </View>
        <View style={styles.rankSection}>
          <Text style={styles.sectionTitle}>{t("gameOverOverlay.rankingsTitle")}</Text>
          <View style={styles.rankList}>{rankRows}</View>
          <View style={styles.legend}>
            <Ionicons name="information-circle-outline" size={11} color={Colors.textMuted} />
            <Text style={styles.legendText}>
              {t("result.legend", { a: numPlayers - 1, b: numPlayers - 2 })}
            </Text>
          </View>
        </View>
        {verdictLine && <Text style={styles.verdictLine}>{verdictLine}</Text>}
        {actionsBlock()}
      </ScrollView>

      {showExchange && gameState.exchangePhase && (
        <ResultExchangeOverlay gameState={gameState} chooseExchangeCard={chooseExchangeCard} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    alignItems: "center",
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerLandscape: { paddingHorizontal: Spacing.md - 4 },
  headerMulti: { alignItems: "center", gap: Spacing.xs },
  headerTitle: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.lg,
    color: Colors.text,
    letterSpacing: 2,
  },
  headerFormat: {
    ...Type.caption,
    color: Colors.gold,
    letterSpacing: 1,
  },
  verdictLine: {
    ...Type.caption,
    textAlign: "center",
  },

  portraitScroll: {
    padding: Spacing.wide,
    gap: Spacing.md,
  },

  landscapeBody: {
    flex: 1,
    flexDirection: "row",
    paddingHorizontal: Spacing.slim,
    paddingTop: Spacing.slim,
    paddingBottom: Spacing.sm,
    gap: Spacing.snug,
  },
  landscapeLeft: {
    width: 170,
    minWidth: 130,
    maxWidth: 200,
    justifyContent: "space-between",
    paddingVertical: Spacing.xs,
    gap: Spacing.sm,
  },
  landscapeRight: {
    flex: 1,
    minWidth: 0,
    paddingVertical: Spacing.xs,
    gap: Spacing.slim,
  },
  landscapeRankScroll: { flex: 1 },
  landscapeRankList: { gap: Spacing.xs + 1 },
  rankSection: { gap: Spacing.xs + 2 },


  celebration: {
    alignItems: "center",
    gap: Spacing.sm,
    position: "relative",
    paddingTop: Spacing.snug,
    paddingBottom: Spacing.slim,
  },
  celebrationCompact: {
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.xxs,
    gap: Spacing.xs,
  },
  celebGlow: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: Radius.full,
    backgroundColor: Colors.gold,
    top: -10,
    opacity: 0.07,
  },
  celebGlowCompact: {
    width: 80,
    height: 80,
    borderRadius: Radius.full,
    top: -5,
  },
  trophyCircle: {
    overflow: "hidden",
    borderWidth: 2,
    borderColor: Colors.gold,
  },
  trophyGrad: { flex: 1, alignItems: "center", justifyContent: "center" },
  winnerName: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.xl,
    color: Colors.text,
    letterSpacing: 2,
    maxWidth: 200,
    textAlign: "center",
  },
  winnerNameCompact: {
    fontSize: FontSize.lg,
    maxWidth: 180,
  },
  winnerSub: {
    fontFamily: "Inter_500Medium",
    fontSize: FontSize.xxs,
    color: Colors.gold,
    letterSpacing: 3,
    textTransform: "uppercase",
  },

  statsRow: { flexDirection: "row", gap: Spacing.slim },
  statsRowLandscape: { flexDirection: "row", gap: Spacing.xs },
  statItem: {
    flex: 1,
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.sm,
    padding: Spacing.sm,
    alignItems: "center",
    gap: Spacing.xxs,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statValue: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.sm,
    color: Colors.text,
  },
  statLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.xxs,
    color: Colors.textMuted,
  },

  actions: { gap: Spacing.sm },
  actionsRow: { flexDirection: "row", gap: Spacing.sm },
  homeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.slim,
    paddingVertical: Spacing.wide,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.bgSurface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  homeBtnCompact: {
    paddingVertical: Spacing.wide,
    paddingHorizontal: Spacing.wide,
    borderRadius: Radius.md,
  },
  homeBtnText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: FontSize.md,
    color: Colors.textSecondary,
  },
  rematchBtn: { borderRadius: Radius.md, overflow: "hidden" },
  rematchBtnFlex: { flex: 1 },
  rematchGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.wide,
    paddingHorizontal: Spacing.md,
  },
  rematchGradCompact: {
    paddingVertical: Spacing.wide,
  },
  rematchText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.md,
    color: Colors.bgCard,
    letterSpacing: 0.5,
  },

  sectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: FontSize.xxs,
    color: Colors.textMuted,
    letterSpacing: 2,
  },
  rankList: { gap: Spacing.xs },
  rankCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.sm,
    paddingVertical: Spacing.slim,
    paddingHorizontal: Spacing.snug,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  rankCardWinner: { borderColor: Colors.gold },
  posBadge: {
    width: 26,
    height: 26,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  posLabel: { fontFamily: "Rajdhani_700Bold", fontSize: FontSize.xs },
  playerName: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: FontSize.sm,
    color: Colors.text,
  },
  teamLabel: { fontFamily: "Inter_500Medium", fontSize: FontSize.xxs, marginTop: Spacing.xxs },
  scoreBlock: {
    alignItems: "flex-end",
    gap: 0,
  },
  totalScore: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.lg,
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  totalScoreWinner: { color: Colors.gold },
  scoreSub: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.xxs,
    color: Colors.textMuted,
  },
  legend: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingTop: Spacing.xxs,
  },
  legendText: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.xxs,
    color: Colors.textMuted,
  },
});

