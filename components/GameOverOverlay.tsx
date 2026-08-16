// End-of-hand results for the online table: final standings, cumulative match
// points, and the rematch vote. Offline has no equivalent — it navigates to
// app/result.tsx instead — so this is passed to <GameTable> through the
// `overlays` slot rather than living inside it.

import React, { useEffect } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  withSequence,
  withRepeat,
  withDelay,
  cancelAnimation,
  Easing,
  FadeIn,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import type { GameState } from "@/lib/gameEngine";
import { Colors, FontSize, Motion, Radius, Spacing } from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useTranslation, type TranslationKey } from "@/lib/i18n";

const POSITION_MEDALS = ["trophy", "medal", "ribbon", "remove-circle"] as const;
const POSITION_COLORS = [Colors.podiumGold, Colors.podiumSilver, Colors.podiumBronze, Colors.textMuted];
const POSITION_LABEL_KEYS: TranslationKey[] = [
  "gameOverOverlay.position1",
  "gameOverOverlay.position2",
  "gameOverOverlay.position3",
  "gameOverOverlay.position4",
];

/** Stagger between ranking rows, after an initial beat. */
const RANK_STAGGER_MS = 80;
const RANK_LEAD_IN_MS = 300;

export interface RematchVote {
  votes: string[];
  total: number;
}

function RankCard({
  rank,
  name,
  isWinner,
  delay,
  cumPts,
}: {
  rank: number;
  name: string;
  isWinner: boolean;
  delay: number;
  cumPts?: number;
}) {
  const { t } = useTranslation();
  const reduceMotion = usePrefersReducedMotion();
  const opacity = useSharedValue(0);
  const tx = useSharedValue(40);

  useEffect(() => {
    if (reduceMotion) {
      opacity.value = 1;
      tx.value = 0;
      return;
    }
    opacity.value = withDelay(delay, withTiming(1, { duration: 350 }));
    tx.value = withDelay(delay, withSpring(0, { damping: 15, stiffness: 200 }));
  }, [reduceMotion]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: tx.value }],
  }));

  const color = POSITION_COLORS[rank] ?? Colors.textMuted;
  const icon = POSITION_MEDALS[rank] ?? "person";
  const labelKey = POSITION_LABEL_KEYS[rank];
  const label = labelKey ? t(labelKey) : `${rank + 1}°`;

  return (
    <Animated.View style={[styles.rankCard, isWinner && styles.rankCardWinner, animStyle]}>
      {isWinner && (
        <LinearGradient
          colors={[Colors.goldMuted, "transparent"]}
          style={StyleSheet.absoluteFill}
        />
      )}
      <View style={[styles.positionBadge, { borderColor: color }]}>
        <Text style={[styles.positionLabel, { color }]}>{label}</Text>
      </View>
      <Ionicons
        name={icon as React.ComponentProps<typeof Ionicons>["name"]}
        size={16}
        color={color}
      />
      <Text style={styles.playerName} numberOfLines={1}>
        {name}
      </Text>
      {cumPts !== undefined && cumPts > 0 && (
        <View style={styles.cumScore}>
          <Text style={styles.cumScoreText}>{t("gameOverOverlay.pointsAbbrev", { n: cumPts })}</Text>
        </View>
      )}
    </Animated.View>
  );
}

export function GameOverOverlay({
  gameState,
  topPad,
  bottomPad,
  onLeave,
  onVoteRematch,
  voteState,
  myUserId,
  cumulativeScores,
}: {
  gameState: GameState;
  topPad: number;
  bottomPad: number;
  onLeave: () => void;
  onVoteRematch: () => void;
  voteState: RematchVote | null;
  myUserId: string;
  cumulativeScores: Record<string, number>;
}) {
  const { t } = useTranslation();
  const winnerName = gameState.rankings[0] ?? "";
  const reduceMotion = usePrefersReducedMotion();
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);
  const glow = useSharedValue(0.5);

  useEffect(() => {
    if (reduceMotion) {
      scale.value = 1;
      opacity.value = 1;
      glow.value = 0.75;
      return;
    }
    scale.value = withSpring(1, Motion.spring.reveal);
    opacity.value = withTiming(1, { duration: Motion.duration.slow });
    glow.value = withRepeat(
      withSequence(
        withTiming(1, { duration: Motion.duration.pulse, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.5, { duration: Motion.duration.pulse, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      false
    );
    return () => {
      cancelAnimation(glow);
    };
  }, [reduceMotion]);

  const celebStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));
  const glowAnim = useAnimatedStyle(() => ({ opacity: glow.value }));

  const hasVoted = voteState?.votes.includes(myUserId) ?? false;
  const voteCount = voteState?.votes.length ?? 0;
  const voteTotal = voteState?.total ?? gameState.players.length;

  return (
    <Animated.View
      entering={FadeIn.duration(Motion.duration.moderate + 100)}
      style={[styles.overlay, { paddingTop: topPad + 4, paddingBottom: bottomPad + 4 }]}
    >
      <LinearGradient
        colors={[Colors.bg, Colors.bgCard, Colors.bg]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.innerCol}>
        <Animated.View style={[styles.celebRow, celebStyle]}>
          <Animated.View style={[styles.celebGlow, glowAnim]} />
          <View style={styles.trophyCircle}>
            <LinearGradient
              colors={[Colors.gold, Colors.goldDark]}
              style={styles.trophyGradient}
            >
              <Ionicons name="trophy" size={26} color={Colors.bgCard} />
            </LinearGradient>
          </View>
          <View style={styles.celebTextBlock}>
            <Text style={styles.winnerName} numberOfLines={1}>
              {winnerName}
            </Text>
            <Text style={styles.winnerSubtitle}>{t("gameOverOverlay.winnerSubtitle")}</Text>
          </View>
          <View style={styles.statPills}>
            <View style={styles.statPill}>
              <Ionicons name="people" size={11} color={Colors.gold} />
              <Text style={styles.statPillText}>{gameState.players.length}P</Text>
            </View>
            <View style={styles.statPill}>
              <Ionicons
                name={gameState.gameMode === "teams" ? "people-circle" : "person-circle"}
                size={11}
                color={Colors.textMuted}
              />
              <Text style={styles.statPillText}>
                {gameState.gameMode === "teams" ? t("gameOverOverlay.modeTeams") : t("gameOverOverlay.modeFreeForAll")}
              </Text>
            </View>
          </View>
        </Animated.View>

        <Text style={styles.sectionTitle}>{t("gameOverOverlay.rankingsTitle")}</Text>
        <ScrollView
          showsVerticalScrollIndicator={false}
          style={styles.rankScroll}
          contentContainerStyle={styles.rankList}
        >
          {gameState.rankings.map((name, i) => (
            <RankCard
              key={i}
              rank={i}
              name={name}
              isWinner={i === 0}
              delay={i * RANK_STAGGER_MS + RANK_LEAD_IN_MS}
              cumPts={cumulativeScores[name]}
            />
          ))}
        </ScrollView>

        <View style={styles.actions}>
          <Pressable
            onPress={onLeave}
            style={styles.homeBtn}
            accessibilityRole="button"
            accessibilityLabel={t("gameOverOverlay.leaveA11yLabel")}
          >
            <Ionicons name="home" size={15} color={Colors.textSecondary} />
            <Text style={styles.homeBtnText}>{t("gameOverOverlay.leave")}</Text>
          </Pressable>
          <Pressable
            testID="btn-rivincita"
            onPress={hasVoted ? undefined : onVoteRematch}
            style={[styles.rematchBtn, hasVoted && styles.rematchBtnDim]}
            accessibilityRole="button"
            accessibilityLabel={t("gameOverOverlay.voteRematchA11yLabel")}
            accessibilityState={{ disabled: hasVoted }}
          >
            <LinearGradient
              colors={
                hasVoted
                  ? [Colors.bgSurface, Colors.bgSurface]
                  : [Colors.gold, Colors.goldDark]
              }
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.rematchGradient}
            >
              <Ionicons
                name={hasVoted ? "checkmark-circle" : "refresh"}
                size={15}
                color={hasVoted ? Colors.accent : Colors.bgCard}
              />
              <Text
                style={[styles.rematchText, hasVoted && { color: Colors.textMuted }]}
                numberOfLines={1}
              >
                {hasVoted ? t("gameOverOverlay.rematchVotes", { count: voteCount, total: voteTotal }) : t("gameOverOverlay.rematch")}
              </Text>
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 300,
    paddingHorizontal: Spacing.lg - 4,
  },
  innerCol: { flex: 1, flexDirection: "column", gap: 6 },

  celebRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: Colors.goldGhost,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.goldSoft,
    paddingVertical: Spacing.sm,
    paddingHorizontal: 12,
    position: "relative",
    overflow: "hidden",
  },
  celebGlow: {
    position: "absolute",
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: Colors.gold,
    opacity: 0.08,
    left: -20,
    top: -30,
  },
  trophyCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: Colors.gold,
    flexShrink: 0,
  },
  trophyGradient: { flex: 1, alignItems: "center", justifyContent: "center" },
  celebTextBlock: { flex: 1, minWidth: 0, gap: 1 },
  winnerName: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.lg,
    color: Colors.text,
    letterSpacing: 1,
  },
  winnerSubtitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 9,
    color: Colors.gold,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  statPills: { flexDirection: "row", gap: 5, flexShrink: 0 },
  statPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: Colors.bgSurface,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statPillText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 10,
    color: Colors.textMuted,
  },

  sectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 9,
    color: Colors.textMuted,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  rankScroll: { flex: 1 },
  rankList: { gap: Spacing.xs, paddingBottom: 2 },
  rankCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.bgSurface,
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  rankCardWinner: { borderColor: Colors.gold },
  positionBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  positionLabel: { fontFamily: "Rajdhani_700Bold", fontSize: 10 },
  playerName: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: FontSize.sm,
    color: Colors.text,
    flex: 1,
  },
  cumScore: {
    backgroundColor: Colors.goldMuted,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: Colors.goldDark,
    flexShrink: 0,
  },
  cumScoreText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.xs,
    color: Colors.gold,
  },

  actions: { flexDirection: "row", gap: Spacing.sm },
  homeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: Radius.md,
    backgroundColor: Colors.bgSurface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  homeBtnText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  rematchBtn: { flex: 1, borderRadius: Radius.md, overflow: "hidden" },
  rematchBtnDim: { opacity: 0.6 },
  rematchGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  rematchText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.sm,
    color: Colors.bgCard,
    letterSpacing: 0.5,
    flexShrink: 1,
  },
});
