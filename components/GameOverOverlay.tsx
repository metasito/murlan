// End-of-manche results for the online table: standings, running match points,
// and whatever comes next — the ready gate for the following manche, or the
// verdict of the rematch question once the match itself is over. Offline has
// no equivalent (it navigates to app/result.tsx), so this is passed to
// <GameTable> through the `overlays` slot rather than living inside it.

import React, { useEffect } from "react";
import { Modal, View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
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
import Ionicons from "@expo/vector-icons/Ionicons";
import type { GameState } from "@/lib/gameEngine";
import { standings } from "@/lib/standings";
import { Colors, FontSize, Motion, Radius, Spacing, TOUCH_TARGET_MIN } from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import { a11yState } from "@/lib/a11y";

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

/** The match this manche belongs to, as the server reports it. */
export interface MatchSummary {
  target: number;
  length: "match" | "single";
  over: boolean;
  /** Display names, empty until the match ends. */
  winners: string[];
  isDraw: boolean;
  /** Whether the table's rematch answers came out in favour of another match. */
  continues: boolean;
}

function RankCard({
  rank,
  name,
  isWinner,
  delay,
  cumPts,
  handPts,
}: {
  rank: number;
  name: string;
  isWinner: boolean;
  delay: number;
  cumPts: number;
  handPts: number;
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
    tx.value = withDelay(delay, withSpring(0, Motion.spring.entrance));
  }, [delay, opacity, reduceMotion, tx]);

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
      <Text style={styles.handDelta}>{t("result.pointsDelta", { n: handPts })}</Text>
      <View style={styles.cumScore}>
        <Text style={styles.cumScoreText}>{t("gameOverOverlay.pointsAbbrev", { n: cumPts })}</Text>
      </View>
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
  handScores,
  match,
}: {
  gameState: GameState;
  topPad: number;
  bottomPad: number;
  onLeave: () => void;
  onVoteRematch: () => void;
  voteState: RematchVote | null;
  myUserId: string;
  cumulativeScores: Record<string, number>;
  /** What the manche just played awarded, by display name. */
  handScores: Record<string, number>;
  match: MatchSummary;
}) {
  const { t } = useTranslation();
  // `rankings` holds engine player ids (`player_0`); everything shown here and
  // every cumulative-score key is a display name.
  const nameOf = (playerId: string) =>
    gameState.players.find((p) => p.id === playerId)?.name ?? playerId;
  const rankedNames = gameState.rankings.map(nameOf);
  const rows = standings(
    rankedNames.map((name, finishedAt) => ({
      name,
      finishedAt,
      total: cumulativeScores[name] ?? 0,
      points: handScores[name] ?? 0,
    }))
  );
  const celebratedName = match.over
    ? (match.winners[0] ?? rankedNames[0] ?? "")
    : (rankedNames[0] ?? "");
  const celebrationSubtitle = match.over
    ? match.isDraw
      ? t("gameOverOverlay.drawSubtitle")
      : t("gameOverOverlay.matchWinnerSubtitle")
    : t("gameOverOverlay.handWinnerSubtitle");
  const formatLine =
    match.length === "single"
      ? t("gameOverOverlay.singleHandFormat")
      : t("gameOverOverlay.matchProgress", { target: match.target });
  // A match the table voted down offers no way to restart it.
  const canContinue = !match.over || match.continues;
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
  }, [glow, opacity, reduceMotion, scale]);

  const celebStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));
  const glowAnim = useAnimatedStyle(() => ({ opacity: glow.value }));

  const hasVoted = voteState?.votes.includes(myUserId) ?? false;
  const voteCount = voteState?.votes.length ?? 0;
  const voteTotal = voteState?.total ?? gameState.players.length;

  return (
    // The manche is over and every route onward is a control inside this
    // overlay, so Escape has nothing to reveal behind it.
    <Modal
      transparent
      visible
      accessibilityLabel={t("gameOverOverlay.rankingsTitle")}
      supportedOrientations={["portrait", "landscape"]}
      onRequestClose={() => {}}
    >
      <Animated.View
        entering={reduceMotion ? undefined : FadeIn.duration(Motion.duration.moderate + 100)}
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
                {celebratedName}
              </Text>
              <Text style={styles.winnerSubtitle}>{celebrationSubtitle}</Text>
            </View>
            <View style={styles.statPills}>
              <View style={styles.statPill}>
                <Ionicons name="flag" size={11} color={Colors.gold} />
                <Text style={styles.statPillText}>{formatLine}</Text>
              </View>
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
            {rows.map((row, i) => (
              <RankCard
                key={row.name}
                rank={i}
                name={row.name}
                isWinner={i === 0}
                delay={i * RANK_STAGGER_MS + RANK_LEAD_IN_MS}
                cumPts={row.total}
                handPts={row.points}
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
            {canContinue ? (
              <Pressable
                testID="btn-rivincita"
                onPress={onVoteRematch}
                disabled={hasVoted}
                style={[styles.rematchBtn, hasVoted && styles.rematchBtnDim]}
                accessibilityLabel={
                  match.over
                    ? t("gameOverOverlay.newMatchA11yLabel")
                    : t("gameOverOverlay.nextHandA11yLabel")
                }
                {...a11yState({ role: "button", disabled: hasVoted })}
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
                    name={hasVoted ? "checkmark-circle" : match.over ? "refresh" : "play-forward"}
                    size={15}
                    color={hasVoted ? Colors.accent : Colors.bgCard}
                  />
                  <Text
                    style={[styles.rematchText, hasVoted && styles.rematchTextWaiting]}
                    numberOfLines={1}
                  >
                    {hasVoted
                      ? t("gameOverOverlay.nextHandWaiting", { count: voteCount, total: voteTotal })
                      : match.over
                        ? t("gameOverOverlay.newMatch")
                        : t("gameOverOverlay.nextHand")}
                  </Text>
                </LinearGradient>
              </Pressable>
            ) : (
              <Text style={styles.tableStops}>{t("gameOverOverlay.tableStops")}</Text>
            )}
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 300,
    paddingHorizontal: Spacing.lg - 4,
  },
  innerCol: { flex: 1, flexDirection: "column", gap: Spacing.slim },

  celebRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.snug,
    backgroundColor: Colors.goldGhost,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.goldSoft,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.cosy,
    position: "relative",
    overflow: "hidden",
  },
  celebGlow: {
    position: "absolute",
    width: 100,
    height: 100,
    borderRadius: Radius.full,
    backgroundColor: Colors.gold,
    opacity: 0.08,
    left: -20,
    top: -30,
  },
  trophyCircle: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: Colors.gold,
    flexShrink: 0,
  },
  trophyGradient: { flex: 1, alignItems: "center", justifyContent: "center" },
  celebTextBlock: { flex: 1, minWidth: 0, gap: Spacing.xxs },
  winnerName: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.lg,
    color: Colors.text,
    letterSpacing: 1,
  },
  winnerSubtitle: {
    fontFamily: "Inter_500Medium",
    fontSize: FontSize.xxs,
    color: Colors.gold,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  statPills: { flexDirection: "row", gap: Spacing.xs, flexShrink: 0 },
  statPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xxs,
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.slim,
    paddingVertical: Spacing.xxs,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statPillText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: FontSize.xxs,
    color: Colors.textMuted,
  },

  sectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: FontSize.xxs,
    color: Colors.textMuted,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  rankScroll: { flex: 1 },
  rankList: { gap: Spacing.xs, paddingBottom: Spacing.xxs },
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
  positionBadge: {
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  positionLabel: { fontFamily: "Rajdhani_700Bold", fontSize: FontSize.xxs },
  playerName: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: FontSize.sm,
    color: Colors.text,
    flex: 1,
  },
  handDelta: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.xxs,
    color: Colors.textMuted,
    flexShrink: 0,
  },
  cumScore: {
    backgroundColor: Colors.goldMuted,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.slim,
    paddingVertical: Spacing.xxs,
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
    minHeight: TOUCH_TARGET_MIN,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.wide,
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
    minHeight: TOUCH_TARGET_MIN,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.slim,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.wide,
  },
  rematchText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.sm,
    color: Colors.bgCard,
    letterSpacing: 0.5,
    flexShrink: 1,
  },
  rematchTextWaiting: { color: Colors.textMuted },
  tableStops: {
    flex: 1,
    alignSelf: "center",
    textAlign: "center",
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
});
