import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Platform,
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
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useGame, calcRoundPoints } from "@/context/GameContext";
import { CardView } from "@/components/CardView";
import { sortHand } from "@/lib/gameEngine";
import Colors from "@/constants/colors";

const POSITION_MEDALS = ["trophy", "medal", "ribbon", "remove-circle"];
const POSITION_COLORS = [Colors.gold, "#C0C0C0", "#CD7F32", Colors.textMuted];
const POSITION_LABELS = ["1°", "2°", "3°", "4°"];

// ─── RankCard ─────────────────────────────────────────────────────────────────

interface RankCardProps {
  rank: number;
  name: string;
  isWinner: boolean;
  delay: number;
  team?: "A" | "B";
  pointsEarned?: number;
  totalPoints?: number;
}

function RankCard({ rank, name, isWinner, delay, team, pointsEarned, totalPoints }: RankCardProps) {
  const opacity = useSharedValue(0);
  const translateX = useSharedValue(60);
  const scale = useSharedValue(0.9);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 400 }));
    translateX.value = withDelay(delay, withSpring(0, { damping: 15, stiffness: 200 }));
    scale.value = withDelay(delay, withSpring(1, { damping: 12, stiffness: 200 }));
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: translateX.value }, { scale: scale.value }],
  }));

  const color = POSITION_COLORS[rank] ?? Colors.textMuted;
  const icon = POSITION_MEDALS[rank] ?? "person";
  const label = POSITION_LABELS[rank] ?? `${rank + 1}°`;

  return (
    <Animated.View style={[styles.rankCard, isWinner && styles.rankCardWinner, animStyle]}>
      {isWinner && (
        <LinearGradient colors={["rgba(201,168,76,0.15)", "transparent"]} style={StyleSheet.absoluteFill} />
      )}
      <View style={[styles.positionBadge, { borderColor: color }]}>
        <Text style={[styles.positionLabel, { color }]}>{label}</Text>
      </View>
      <Ionicons name={icon as React.ComponentProps<typeof Ionicons>["name"]} size={24} color={color} />
      <View style={{ flex: 1 }}>
        <Text style={styles.playerName}>{name}</Text>
        {team && (
          <Text style={[styles.teamLabel, { color: team === "A" ? Colors.accent : Colors.gold }]}>
            Team {team}
          </Text>
        )}
      </View>
      {pointsEarned !== undefined && (
        <View style={styles.pointsBadge}>
          <Text style={styles.pointsPlus}>+{pointsEarned}</Text>
        </View>
      )}
      {totalPoints !== undefined && (
        <View style={styles.totalPtsBadge}>
          <Text style={styles.totalPtsText}>{totalPoints} pt</Text>
        </View>
      )}
      {isWinner && pointsEarned === undefined && (
        <View style={styles.winnerBadge}>
          <Text style={styles.winnerBadgeText}>VINCITORE</Text>
        </View>
      )}
    </Animated.View>
  );
}

// ─── Scoreboard Row ───────────────────────────────────────────────────────────

function ScoreRow({ name, score, isLeader, rank, delay }: { name: string; score: number; isLeader: boolean; rank: number; delay: number }) {
  const opacity = useSharedValue(0);
  const tx = useSharedValue(40);
  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 350 }));
    tx.value = withDelay(delay, withSpring(0, { damping: 14, stiffness: 200 }));
  }, []);
  const aStyle = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateX: tx.value }] }));
  const color = POSITION_COLORS[rank] ?? Colors.textMuted;

  return (
    <Animated.View style={[sbStyles.row, isLeader && sbStyles.rowLeader, aStyle]}>
      {isLeader && <LinearGradient colors={["rgba(201,168,76,0.1)", "transparent"]} style={StyleSheet.absoluteFill} />}
      <Text style={[sbStyles.rankNum, { color }]}>{rank + 1}</Text>
      <Text style={sbStyles.name}>{name}</Text>
      <Text style={[sbStyles.score, isLeader && sbStyles.scoreLeader]}>{score}</Text>
      {isLeader && <Ionicons name="star" size={12} color={Colors.gold} />}
    </Animated.View>
  );
}

// ─── WinnerCelebration ────────────────────────────────────────────────────────

function WinnerCelebration({ name, subtitle }: { name: string; subtitle?: string }) {
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);
  const glow = useSharedValue(0.6);

  useEffect(() => {
    scale.value = withSpring(1, { damping: 8, stiffness: 150 });
    opacity.value = withTiming(1, { duration: 600 });
    glow.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.6, { duration: 1200, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      false
    );
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  return (
    <Animated.View style={[styles.celebration, containerStyle]}>
      <Animated.View style={[styles.celebrationGlow, glowStyle]} />
      <View style={styles.trophyCircle}>
        <LinearGradient colors={[Colors.gold, Colors.goldDark]} style={styles.trophyGradient}>
          <Ionicons name="trophy" size={44} color="#0A1F18" />
        </LinearGradient>
      </View>
      <Text style={styles.winnerName}>{name}</Text>
      <Text style={styles.winnerSubtitle}>{subtitle ?? "Vincitore"}</Text>
    </Animated.View>
  );
}

// ─── Card Exchange Overlay ────────────────────────────────────────────────────

function CardExchangeOverlay({
  gameState,
  chooseExchangeCard,
}: {
  gameState: NonNullable<ReturnType<typeof useGame>["gameState"]>;
  chooseExchangeCard: (cardId: string) => void;
}) {
  const ep = gameState.exchangePhase!;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const autoRef = useRef(false);

  const winner = gameState.players[ep.winnerIdx];
  const loser = gameState.players[ep.loserIdx];

  const exchangeCards = sortHand(winner.hand.filter(
    (c) => ["3", "4", "5", "6", "7", "8", "9", "10"].includes(c.rank)
  ));

  useEffect(() => {
    if (ep.bothJokersException) {
      const t = setTimeout(() => router.replace("/game"), 2500);
      return () => clearTimeout(t);
    }
    if (winner.type === "ai" && !autoRef.current) {
      autoRef.current = true;
      const t = setTimeout(() => {
        if (exchangeCards.length > 0) chooseExchangeCard(exchangeCards[0].id);
      }, 900);
      return () => clearTimeout(t);
    }
  }, []);

  if (ep.bothJokersException) {
    return (
      <View style={exStyles.overlay}>
        <View style={exStyles.card}>
          <View style={exStyles.jokerRow}>
            <Text style={exStyles.jokerEmoji}>🃏🃏</Text>
          </View>
          <Text style={exStyles.title}>IL PERDENTE HA ENTRAMBI I JOLLY!</Text>
          <Text style={exStyles.subtitle}>
            {winner.name} inizia libero.{"\n"}Nessuno scambio di carte.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={exStyles.overlay}>
      <View style={exStyles.card}>
        <Text style={exStyles.title}>SCAMBIO CARTE</Text>
        <View style={exStyles.section}>
          <Text style={exStyles.label}>{loser.name} cede a {winner.name}:</Text>
          <View style={exStyles.singleCard}>
            <CardView card={ep.cardFromLoser} />
          </View>
        </View>
        {winner.type === "ai" ? (
          <View style={exStyles.section}>
            <Text style={exStyles.label}>{winner.name} sceglie...</Text>
            <Text style={exStyles.aiChoosing}>⏳ Scelta in corso</Text>
          </View>
        ) : (
          <View style={exStyles.section}>
            <Text style={exStyles.label}>
              {winner.name} sceglie una carta da restituire (3–10):
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={exStyles.pickRow}>
              {exchangeCards.map((card) => {
                const picked = selectedId === card.id;
                return (
                  <Pressable
                    key={card.id}
                    onPress={() => { setSelectedId(card.id); Haptics.selectionAsync(); }}
                    style={[exStyles.pickCardWrap, picked && exStyles.pickCardLifted]}
                  >
                    <CardView card={card} selected={picked} noLift />
                  </Pressable>
                );
              })}
              {exchangeCards.length === 0 && (
                <Text style={exStyles.noCards}>Nessuna carta 3–10 disponibile</Text>
              )}
            </ScrollView>
            <Pressable
              onPress={() => {
                if (selectedId) {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  chooseExchangeCard(selectedId);
                }
              }}
              style={[exStyles.confirmBtn, !selectedId && exStyles.confirmBtnDim]}
              disabled={!selectedId}
            >
              <LinearGradient
                colors={selectedId ? [Colors.gold, Colors.goldDark] : [Colors.bgSurface, Colors.bgSurface]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={exStyles.confirmGrad}
              >
                <Text style={[exStyles.confirmText, !selectedId && { color: Colors.textMuted }]}>
                  Conferma scambio
                </Text>
              </LinearGradient>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Main Result Screen ───────────────────────────────────────────────────────

export default function ResultScreen() {
  const insets = useSafeAreaInsets();
  const {
    gameState,
    setupRematch,
    startNextRound,
    chooseExchangeCard,
    resetGame,
    totalRounds,
    currentRound,
    cumulativeScores,
    roundHistory,
  } = useGame();
  const prevExchangeActiveRef = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    if (!gameState?.exchangePhase) return;
    const wasActive = prevExchangeActiveRef.current;
    const isActive = gameState.exchangePhase.active;
    if (wasActive === true && isActive === false && !gameState.exchangePhase.bothJokersException) {
      router.replace("/game");
    }
    prevExchangeActiveRef.current = isActive;
  }, [gameState?.exchangePhase?.active]);

  useEffect(() => {
    if (!gameState) router.replace("/");
  }, [gameState]);

  if (!gameState) return null;

  const showExchange = gameState.exchangePhase?.active === true || gameState.exchangePhase?.bothJokersException === true;
  const isMultiRound = totalRounds > 1;
  const isLastRound = currentRound >= totalRounds;

  const numPlayers = gameState.players.length;

  // Points earned THIS round
  const thisRoundPoints = calcRoundPoints(gameState.rankings, numPlayers);

  // Cumulative scores including this round
  const fullScores: Record<string, number> = {};
  for (const name of gameState.rankings) {
    fullScores[name] = (cumulativeScores[name] ?? 0) + (thisRoundPoints[name] ?? 0);
  }

  // Sorted by cumulative score descending (for scoreboard)
  const scoreboardEntries = Object.entries(fullScores)
    .sort((a, b) => b[1] - a[1]);
  const overallWinner = scoreboardEntries[0]?.[0] ?? "";

  // Sort players by this round's finish position
  const sortedPlayers = [...gameState.players].sort(
    (a, b) => (a.finishPosition ?? 99) - (b.finishPosition ?? 99)
  );

  const winner = sortedPlayers[0];
  const isTeamMode = gameState.gameMode === "teams";
  const winnerTeam = isTeamMode ? winner.team : null;
  const displayName = isTeamMode && winnerTeam ? `Team ${winnerTeam}` : winner.name;

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const handleNextRound = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    startNextRound();
    router.replace("/game");
  };

  const handleRematch = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const playerSetups = gameState.players.map((p) => ({
      name: p.name,
      type: p.type,
      difficulty: p.difficulty,
      team: p.team,
    }));
    setupRematch(playerSetups, gameState.gameMode, gameState.rankings);
  };

  const handleHome = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    resetGame();
    router.replace("/");
  };

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <LinearGradient
        colors={[Colors.bg, Colors.bgCard, Colors.bg]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.header}>
        {isMultiRound ? (
          <View style={styles.headerMulti}>
            <Text style={styles.headerTitle}>
              {isLastRound ? "Partita Finita!" : `Manche ${currentRound} di ${totalRounds}`}
            </Text>
            <View style={styles.roundPips}>
              {Array.from({ length: totalRounds }, (_, i) => (
                <View
                  key={i}
                  style={[
                    styles.pip,
                    i < currentRound && styles.pipDone,
                    i === currentRound - 1 && styles.pipCurrent,
                  ]}
                />
              ))}
            </View>
          </View>
        ) : (
          <Text style={styles.headerTitle}>Partita Finita</Text>
        )}
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomPad + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Winner celebration — show overall winner on last round, round winner otherwise */}
        {isLastRound || !isMultiRound ? (
          <WinnerCelebration
            name={isMultiRound ? overallWinner : displayName}
            subtitle={isMultiRound ? "Campione del Torneo" : "Vincitore"}
          />
        ) : (
          <WinnerCelebration name={displayName} subtitle={`Vince la Manche ${currentRound}`} />
        )}

        {/* This round's rankings with points earned */}
        <View style={styles.rankingSection}>
          <Text style={styles.rankingTitle}>
            {isMultiRound ? `RISULTATI MANCHE ${currentRound}` : "CLASSIFICA"}
          </Text>
          <View style={styles.rankList}>
            {sortedPlayers.map((player, idx) => (
              <RankCard
                key={player.id}
                rank={idx}
                name={player.name}
                isWinner={idx === 0}
                delay={idx * 100 + 300}
                team={isTeamMode ? player.team : undefined}
                pointsEarned={isMultiRound ? thisRoundPoints[player.name] : undefined}
              />
            ))}
          </View>
        </View>

        {/* Cumulative scoreboard — only in multi-round mode */}
        {isMultiRound && (
          <View style={styles.rankingSection}>
            <Text style={styles.rankingTitle}>CLASSIFICA GENERALE</Text>
            <View style={sbStyles.board}>
              {scoreboardEntries.map(([name, score], idx) => (
                <ScoreRow
                  key={name}
                  name={name}
                  score={score}
                  isLeader={idx === 0}
                  rank={idx}
                  delay={idx * 80 + 500}
                />
              ))}
            </View>
            {/* Points legend */}
            <View style={sbStyles.legend}>
              <Ionicons name="information-circle-outline" size={13} color={Colors.textMuted} />
              <Text style={sbStyles.legendText}>
                Punti: {Array.from({ length: numPlayers }, (_, i) => Math.max(0, numPlayers - 1 - i)).join(" / ")} (1° → ultimo)
              </Text>
            </View>
          </View>
        )}

        {/* Stats */}
        <View style={styles.statsSection}>
          <Text style={styles.statsTitle}>RIEPILOGO</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <Ionicons name="people" size={20} color={Colors.gold} />
              <Text style={styles.statValue}>{numPlayers}</Text>
              <Text style={styles.statLabel}>Giocatori</Text>
            </View>
            {isMultiRound && (
              <View style={styles.statItem}>
                <Ionicons name="layers" size={20} color={Colors.gold} />
                <Text style={styles.statValue}>{currentRound}/{totalRounds}</Text>
                <Text style={styles.statLabel}>Manche</Text>
              </View>
            )}
            <View style={styles.statItem}>
              <Ionicons
                name={gameState.gameMode === "teams" ? "people-circle" : "person-circle"}
                size={20}
                color={Colors.gold}
              />
              <Text style={styles.statValue}>
                {gameState.gameMode === "teams" ? "Coppie" : "Libero"}
              </Text>
              <Text style={styles.statLabel}>Modalità</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Action buttons */}
      <View style={[styles.actions, { paddingBottom: bottomPad + 16 }]}>
        <LinearGradient
          colors={["transparent", Colors.bg, Colors.bg]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <Pressable testID="btn-home" onPress={handleHome} style={styles.homeBtn}>
          <Ionicons name="home" size={18} color={Colors.textSecondary} />
          <Text style={styles.homeBtnText}>Home</Text>
        </Pressable>

        {isMultiRound && !isLastRound ? (
          <Pressable testID="btn-prossimo" onPress={handleNextRound} style={styles.rematchBtn}>
            <LinearGradient
              colors={[Colors.gold, Colors.goldDark]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={styles.rematchGradient}
            >
              <Ionicons name="play-forward" size={18} color="#0A1F18" />
              <Text style={styles.rematchText}>Prossima Manche</Text>
            </LinearGradient>
          </Pressable>
        ) : (
          <Pressable testID="btn-rivincita" onPress={handleRematch} style={styles.rematchBtn}>
            <LinearGradient
              colors={[Colors.gold, Colors.goldDark]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={styles.rematchGradient}
            >
              <Ionicons name="refresh" size={18} color="#0A1F18" />
              <Text style={styles.rematchText}>Rivincita</Text>
            </LinearGradient>
          </Pressable>
        )}
      </View>

      {showExchange && gameState.exchangePhase && (
        <CardExchangeOverlay
          gameState={gameState}
          chooseExchangeCard={chooseExchangeCard}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    alignItems: "center",
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerMulti: { alignItems: "center", gap: 8 },
  headerTitle: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 22,
    color: Colors.text,
    letterSpacing: 2,
  },
  roundPips: { flexDirection: "row", gap: 6 },
  pip: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.bgSurface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pipDone: { backgroundColor: Colors.goldDark, borderColor: Colors.gold },
  pipCurrent: { backgroundColor: Colors.gold, borderColor: Colors.gold, width: 18 },
  scroll: { padding: 20, gap: 28 },
  celebration: { alignItems: "center", gap: 12, paddingVertical: 20 },
  celebrationGlow: {
    position: "absolute",
    width: 160, height: 160, borderRadius: 80,
    backgroundColor: Colors.gold, top: 0, opacity: 0.08,
  },
  trophyCircle: {
    width: 100, height: 100, borderRadius: 50,
    overflow: "hidden", borderWidth: 2, borderColor: Colors.gold,
  },
  trophyGradient: { flex: 1, alignItems: "center", justifyContent: "center" },
  winnerName: { fontFamily: "Rajdhani_700Bold", fontSize: 32, color: Colors.text, letterSpacing: 2 },
  winnerSubtitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 13, color: Colors.gold, letterSpacing: 3, textTransform: "uppercase",
  },
  rankingSection: { gap: 12 },
  rankingTitle: { fontFamily: "Inter_600SemiBold", fontSize: 11, color: Colors.textMuted, letterSpacing: 2 },
  rankList: { gap: 10 },
  rankCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: Colors.bgSurface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  rankCardWinner: { borderColor: Colors.gold },
  positionBadge: {
    width: 36, height: 36, borderRadius: 18,
    borderWidth: 1.5, alignItems: "center", justifyContent: "center",
  },
  positionLabel: { fontFamily: "Rajdhani_700Bold", fontSize: 14 },
  playerName: { fontFamily: "Rajdhani_600SemiBold", fontSize: 17, color: Colors.text },
  teamLabel: { fontFamily: "Inter_500Medium", fontSize: 11, marginTop: 2 },
  pointsBadge: {
    backgroundColor: Colors.accentMuted,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  pointsPlus: { fontFamily: "Rajdhani_700Bold", fontSize: 15, color: Colors.accent },
  totalPtsBadge: {
    backgroundColor: Colors.goldMuted,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.goldDark,
  },
  totalPtsText: { fontFamily: "Rajdhani_700Bold", fontSize: 12, color: Colors.gold },
  winnerBadge: {
    backgroundColor: Colors.goldMuted,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: Colors.goldDark,
  },
  winnerBadgeText: { fontFamily: "Rajdhani_700Bold", fontSize: 10, color: Colors.gold, letterSpacing: 1 },
  statsSection: { gap: 12 },
  statsTitle: { fontFamily: "Inter_600SemiBold", fontSize: 11, color: Colors.textMuted, letterSpacing: 2 },
  statsGrid: { flexDirection: "row", gap: 10 },
  statItem: {
    flex: 1, backgroundColor: Colors.bgSurface,
    borderRadius: 12, padding: 16, alignItems: "center", gap: 6,
    borderWidth: 1, borderColor: Colors.border,
  },
  statValue: { fontFamily: "Rajdhani_700Bold", fontSize: 20, color: Colors.text },
  statLabel: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textMuted },
  actions: {
    position: "absolute",
    bottom: 0, left: 0, right: 0,
    flexDirection: "row",
    gap: 12,
    padding: 20,
    paddingTop: 40,
  },
  homeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 14,
    backgroundColor: Colors.bgSurface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  homeBtnText: { fontFamily: "Rajdhani_600SemiBold", fontSize: 16, color: Colors.textSecondary },
  rematchBtn: { flex: 1, borderRadius: 14, overflow: "hidden" },
  rematchGradient: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, paddingVertical: 16,
  },
  rematchText: { fontFamily: "Rajdhani_700Bold", fontSize: 17, color: "#0A1F18", letterSpacing: 0.5 },
});

// ─── Scoreboard styles ────────────────────────────────────────────────────────

const sbStyles = StyleSheet.create({
  board: {
    backgroundColor: Colors.bgSurface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    overflow: "hidden",
  },
  rowLeader: { borderBottomColor: "rgba(201,168,76,0.2)" },
  rankNum: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 18,
    width: 22,
    textAlign: "center",
  },
  name: { fontFamily: "Rajdhani_600SemiBold", fontSize: 16, color: Colors.text, flex: 1 },
  score: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 22,
    color: Colors.textSecondary,
  },
  scoreLeader: { color: Colors.gold },
  legend: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 8,
    paddingHorizontal: 2,
  },
  legendText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: Colors.textMuted,
  },
});

// ─── Exchange overlay styles ──────────────────────────────────────────────────

const exStyles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.88)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  card: {
    backgroundColor: Colors.bgCard,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    padding: 24,
    width: "90%",
    maxWidth: 420,
    gap: 20,
  },
  title: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 16,
    color: Colors.gold,
    letterSpacing: 2,
    textAlign: "center",
  },
  section: { gap: 10 },
  label: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textSecondary },
  singleCard: { alignItems: "center", paddingVertical: 4 },
  pickRow: { flexGrow: 0 },
  pickCardWrap: { marginRight: 8, paddingVertical: 4 },
  pickCardLifted: { transform: [{ translateY: -10 }] },
  confirmBtn: { borderRadius: 12, overflow: "hidden", marginTop: 4 },
  confirmBtnDim: { opacity: 0.5 },
  confirmGrad: { paddingVertical: 14, alignItems: "center", justifyContent: "center" },
  confirmText: { fontFamily: "Rajdhani_700Bold", fontSize: 16, color: "#0A1F18", letterSpacing: 0.5 },
  noCards: {
    fontFamily: "Inter_400Regular",
    fontSize: 12, color: Colors.textMuted,
    alignSelf: "center", paddingVertical: 20,
  },
  aiChoosing: {
    fontFamily: "Inter_400Regular",
    fontSize: 13, color: Colors.textMuted,
    textAlign: "center", paddingVertical: 10,
  },
  jokerRow: { alignItems: "center", paddingVertical: 8 },
  jokerEmoji: { fontSize: 44 },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 14, color: Colors.textSecondary,
    textAlign: "center", lineHeight: 22,
  },
});
