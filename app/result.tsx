import React, { useEffect, useRef, useState } from "react";
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
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useGame, calcRoundPoints } from "@/context/GameContext";
import { CardView } from "@/components/CardView";
import { sortHand } from "@/lib/gameEngine";
import Colors from "@/constants/colors";

const POSITION_COLORS = [Colors.gold, "#C0C0C0", "#CD7F32", Colors.textMuted];
const POSITION_LABELS = ["1°", "2°", "3°", "4°"];
const POSITION_ICONS = ["trophy", "medal", "ribbon", "remove-circle"] as const;

function ScoreRow({
  rank,
  name,
  totalScore,
  pointsEarned,
  isWinner,
  delay,
  team,
  isMultiRound,
}: {
  rank: number;
  name: string;
  totalScore: number;
  pointsEarned: number;
  isWinner: boolean;
  delay: number;
  team?: "A" | "B";
  isMultiRound: boolean;
}) {
  const opacity = useSharedValue(0);
  const tx = useSharedValue(40);
  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 380 }));
    tx.value = withDelay(delay, withSpring(0, { damping: 14, stiffness: 200 }));
  }, []);
  const anim = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: tx.value }],
  }));
  const color = POSITION_COLORS[rank] ?? Colors.textMuted;
  const icon = POSITION_ICONS[rank] ?? "person";
  const label = POSITION_LABELS[rank] ?? `${rank + 1}°`;

  return (
    <Animated.View style={[styles.rankCard, isWinner && styles.rankCardWinner, anim]}>
      {isWinner && (
        <LinearGradient
          colors={["rgba(201,168,76,0.15)", "transparent"]}
          style={StyleSheet.absoluteFill}
        />
      )}
      <View style={[styles.posBadge, { borderColor: color }]}>
        <Text style={[styles.posLabel, { color }]}>{label}</Text>
      </View>
      <Ionicons
        name={icon as React.ComponentProps<typeof Ionicons>["name"]}
        size={18}
        color={color}
      />
      <View style={{ flex: 1 }}>
        <Text style={styles.playerName} numberOfLines={1}>{name}</Text>
        {team && (
          <Text style={[styles.teamLabel, { color: team === "A" ? Colors.accent : Colors.gold }]}>
            Team {team}
          </Text>
        )}
      </View>
      <View style={styles.scoreBlock}>
        <Text style={[styles.totalScore, isWinner && styles.totalScoreWinner]}>
          {totalScore}
        </Text>
        <Text style={styles.scoreSub}>
          {isMultiRound ? `+${pointsEarned} ora` : `punti`}
        </Text>
      </View>
    </Animated.View>
  );
}

function WinnerCelebration({
  name,
  subtitle,
}: {
  name: string;
  subtitle?: string;
}) {
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);
  const glow = useSharedValue(0.5);
  useEffect(() => {
    scale.value = withSpring(1, { damping: 8, stiffness: 150 });
    opacity.value = withTiming(1, { duration: 600 });
    glow.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.5, { duration: 1200, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      false
    );
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);
  const containerAnim = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));
  const glowAnim = useAnimatedStyle(() => ({ opacity: glow.value }));

  return (
    <Animated.View style={[styles.celebration, containerAnim]}>
      <Animated.View style={[styles.celebGlow, glowAnim]} />
      <View style={styles.trophyCircle}>
        <LinearGradient
          colors={[Colors.gold, Colors.goldDark]}
          style={styles.trophyGrad}
        >
          <Ionicons name="trophy" size={36} color="#0A1F18" />
        </LinearGradient>
      </View>
      <Text style={styles.winnerName} numberOfLines={1}>{name}</Text>
      <Text style={styles.winnerSub}>{subtitle ?? "Vincitore"}</Text>
    </Animated.View>
  );
}

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
  const exchangeCards = sortHand(
    winner.hand.filter((c) =>
      ["3", "4", "5", "6", "7", "8", "9", "10"].includes(c.rank)
    )
  );

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
          <Text style={exStyles.jokerEmoji}>🃏🃏</Text>
          <Text style={exStyles.title}>IL PERDENTE HA ENTRAMBI I JOLLY!</Text>
          <Text style={exStyles.subtitle}>
            {winner.name} inizia libero.{"\n"}Nessuno scambio.
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
          <Text style={exStyles.label}>
            {loser.name} cede a {winner.name}:
          </Text>
          <View style={exStyles.singleCard}>
            <CardView card={ep.cardFromLoser} />
          </View>
        </View>
        {winner.type === "ai" ? (
          <Text style={exStyles.aiChoosing}>⏳ {winner.name} sceglie...</Text>
        ) : (
          <View style={exStyles.section}>
            <Text style={exStyles.label}>
              {winner.name} restituisce (3–10):
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={exStyles.pickRow}
            >
              {exchangeCards.map((card) => {
                const picked = selectedId === card.id;
                return (
                  <Pressable
                    key={card.id}
                    onPress={() => {
                      setSelectedId(card.id);
                      Haptics.selectionAsync();
                    }}
                    style={[
                      exStyles.pickCardWrap,
                      picked && exStyles.pickCardLifted,
                    ]}
                  >
                    <CardView card={card} selected={picked} noLift />
                  </Pressable>
                );
              })}
              {exchangeCards.length === 0 && (
                <Text style={exStyles.noCards}>Nessuna carta 3–10</Text>
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
                colors={
                  selectedId
                    ? [Colors.gold, Colors.goldDark]
                    : [Colors.bgSurface, Colors.bgSurface]
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={exStyles.confirmGrad}
              >
                <Text
                  style={[
                    exStyles.confirmText,
                    !selectedId && { color: Colors.textMuted },
                  ]}
                >
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

export default function ResultScreen() {
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const isLandscape = W > H;
  const {
    gameState,
    setupRematch,
    startNextRound,
    chooseExchangeCard,
    resetGame,
    totalRounds,
    currentRound,
    cumulativeScores,
  } = useGame();
  const prevExchangeActiveRef = useRef<boolean | undefined>(undefined);


  useEffect(() => {
    if (!gameState?.exchangePhase) return;
    const wasActive = prevExchangeActiveRef.current;
    const isActive = gameState.exchangePhase.active;
    if (
      wasActive === true &&
      isActive === false &&
      !gameState.exchangePhase.bothJokersException
    ) {
      router.replace("/game");
    }
    prevExchangeActiveRef.current = isActive;
  }, [gameState?.exchangePhase?.active]);

  useEffect(() => {
    if (!gameState) router.replace("/");
  }, [gameState]);

  if (!gameState) return null;

  const showExchange =
    gameState.exchangePhase?.active === true ||
    gameState.exchangePhase?.bothJokersException === true;
  const isMultiRound = totalRounds > 1;
  const isLastRound = currentRound >= totalRounds;
  const numPlayers = gameState.players.length;

  // Points earned this round (keyed by player ID)
  const thisRoundPoints = calcRoundPoints(gameState.rankings, numPlayers);

  // Total score per player (cumulative + this round), keyed by player ID
  const totalScoreById: Record<string, number> = {};
  for (const player of gameState.players) {
    totalScoreById[player.id] =
      (cumulativeScores[player.id] ?? 0) + (thisRoundPoints[player.id] ?? 0);
  }

  // Single sorted list: highest total score first
  const sortedPlayers = [...gameState.players].sort(
    (a, b) => (totalScoreById[b.id] ?? 0) - (totalScoreById[a.id] ?? 0)
  );

  const winner = sortedPlayers[0];
  const isTeamMode = gameState.gameMode === "teams";
  const winnerTeam = isTeamMode ? winner.team : null;
  const displayName =
    isTeamMode && winnerTeam ? `Team ${winnerTeam}` : winner.name;

  // For multi-round overall winner label — player with highest cumulative total
  const overallWinner = sortedPlayers[0]?.name ?? "";

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

  const winnerBlock = (
    <>
      {isLastRound || !isMultiRound ? (
        <WinnerCelebration name={isMultiRound ? overallWinner : displayName} subtitle={isMultiRound ? "Campione del Torneo" : "Vincitore"} />
      ) : (
        <WinnerCelebration name={displayName} subtitle={`Vince la Manche ${currentRound}`} />
      )}
    </>
  );

  const statsBlock = (
    <View style={styles.statsRow}>
      <View style={styles.statItem}>
        <Ionicons name="people" size={16} color={Colors.gold} />
        <Text style={styles.statValue}>{numPlayers}</Text>
        <Text style={styles.statLabel}>Giocatori</Text>
      </View>
      {isMultiRound && (
        <View style={styles.statItem}>
          <Ionicons name="layers" size={16} color={Colors.gold} />
          <Text style={styles.statValue}>{currentRound}/{totalRounds}</Text>
          <Text style={styles.statLabel}>Manche</Text>
        </View>
      )}
      <View style={styles.statItem}>
        <Ionicons name={gameState.gameMode === "teams" ? "people-circle" : "person-circle"} size={16} color={Colors.gold} />
        <Text style={styles.statValue}>{gameState.gameMode === "teams" ? "Coppie" : "Libero"}</Text>
        <Text style={styles.statLabel}>Modalità</Text>
      </View>
    </View>
  );

  const actionsBlock = (
    <View style={styles.actions}>
      <Pressable testID="btn-home" onPress={handleHome} style={styles.homeBtn}>
        <Ionicons name="home" size={16} color={Colors.textSecondary} />
        <Text style={styles.homeBtnText}>Home</Text>
      </Pressable>
      {isMultiRound && !isLastRound ? (
        <Pressable testID="btn-prossimo" onPress={handleNextRound} style={styles.rematchBtn}>
          <LinearGradient colors={[Colors.gold, Colors.goldDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.rematchGrad}>
            <Ionicons name="play-forward" size={16} color="#0A1F18" />
            <Text style={styles.rematchText}>Prossima Manche</Text>
          </LinearGradient>
        </Pressable>
      ) : (
        <Pressable testID="btn-rivincita" onPress={handleRematch} style={styles.rematchBtn}>
          <LinearGradient colors={[Colors.gold, Colors.goldDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.rematchGrad}>
            <Ionicons name="refresh" size={16} color="#0A1F18" />
            <Text style={styles.rematchText}>Rivincita</Text>
          </LinearGradient>
        </Pressable>
      )}
    </View>
  );

  const rankBlock = (
    <View style={styles.rightCol}>
      <Text style={styles.sectionTitle}>CLASSIFICA</Text>
      <View style={styles.rankList}>
        {sortedPlayers.map((player, idx) => (
          <ScoreRow
            key={player.id}
            rank={idx}
            name={player.name}
            totalScore={totalScoreById[player.id] ?? 0}
            pointsEarned={thisRoundPoints[player.id] ?? 0}
            isWinner={idx === 0}
            delay={idx * 80 + 200}
            team={isTeamMode ? player.team : undefined}
            isMultiRound={isMultiRound}
          />
        ))}
      </View>
      <View style={styles.legend}>
        <Ionicons name="information-circle-outline" size={11} color={Colors.textMuted} />
        <Text style={styles.legendText}>
          +{numPlayers - 1} / +{numPlayers - 2} ... +0 per 1° → ultimo
        </Text>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: topPad, paddingBottom: isLandscape ? bottomPad : 0 }]}>
      <LinearGradient colors={[Colors.bg, Colors.bgCard, Colors.bg]} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />

      <View style={styles.header}>
        {isMultiRound ? (
          <View style={styles.headerMulti}>
            <Text style={styles.headerTitle}>
              {isLastRound ? "Partita Finita!" : `Manche ${currentRound} di ${totalRounds}`}
            </Text>
            <View style={styles.roundPips}>
              {Array.from({ length: totalRounds }, (_, i) => (
                <View key={i} style={[styles.pip, i < currentRound && styles.pipDone, i === currentRound - 1 && styles.pipCurrent]} />
              ))}
            </View>
          </View>
        ) : (
          <Text style={styles.headerTitle}>Partita Finita</Text>
        )}
      </View>

      {isLandscape ? (
        <View style={styles.twoCol}>
          <View style={styles.leftCol}>
            {winnerBlock}
            {statsBlock}
            {actionsBlock}
          </View>
          {rankBlock}
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.portraitScroll, { paddingBottom: bottomPad + 24 }]} showsVerticalScrollIndicator={false}>
          {winnerBlock}
          {statsBlock}
          {rankBlock}
          {actionsBlock}
        </ScrollView>
      )}

      {showExchange && gameState.exchangePhase && (
        <CardExchangeOverlay gameState={gameState} chooseExchangeCard={chooseExchangeCard} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerMulti: { alignItems: "center", gap: 6 },
  headerTitle: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 20,
    color: Colors.text,
    letterSpacing: 2,
  },
  roundPips: { flexDirection: "row", gap: 5 },
  pip: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: Colors.bgSurface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pipDone: { backgroundColor: Colors.goldDark, borderColor: Colors.gold },
  pipCurrent: {
    backgroundColor: Colors.gold,
    borderColor: Colors.gold,
    width: 16,
  },

  portraitScroll: {
    padding: 16,
    gap: 20,
  },
  twoCol: {
    flex: 1,
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 16,
  },
  leftCol: {
    width: 210,
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  rightCol: {
    flex: 1,
    paddingVertical: 6,
    gap: 6,
  },

  celebration: {
    alignItems: "center",
    gap: 8,
    position: "relative",
  },
  celebGlow: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: Colors.gold,
    top: -10,
    opacity: 0.07,
  },
  trophyCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: Colors.gold,
  },
  trophyGrad: { flex: 1, alignItems: "center", justifyContent: "center" },
  winnerName: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 26,
    color: Colors.text,
    letterSpacing: 2,
    maxWidth: 200,
    textAlign: "center",
  },
  winnerSub: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    color: Colors.gold,
    letterSpacing: 3,
    textTransform: "uppercase",
  },

  statsRow: { flexDirection: "row", gap: 6 },
  statItem: {
    flex: 1,
    backgroundColor: Colors.bgSurface,
    borderRadius: 10,
    padding: 10,
    alignItems: "center",
    gap: 3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statValue: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 15,
    color: Colors.text,
  },
  statLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 9,
    color: Colors.textMuted,
  },

  actions: { gap: 8 },
  homeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: Colors.bgSurface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  homeBtnText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 15,
    color: Colors.textSecondary,
  },
  rematchBtn: { borderRadius: 12, overflow: "hidden" },
  rematchGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
  },
  rematchText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 16,
    color: "#0A1F18",
    letterSpacing: 0.5,
  },

  sectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 10,
    color: Colors.textMuted,
    letterSpacing: 2,
  },
  rankList: { gap: 6 },
  rankCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: Colors.bgSurface,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  rankCardWinner: { borderColor: Colors.gold },
  posBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  posLabel: { fontFamily: "Rajdhani_700Bold", fontSize: 12 },
  playerName: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 15,
    color: Colors.text,
  },
  teamLabel: { fontFamily: "Inter_500Medium", fontSize: 10, marginTop: 1 },
  scoreBlock: {
    alignItems: "flex-end",
    gap: 1,
  },
  totalScore: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 22,
    color: Colors.textSecondary,
    lineHeight: 24,
  },
  totalScoreWinner: { color: Colors.gold },
  scoreSub: {
    fontFamily: "Inter_400Regular",
    fontSize: 9,
    color: Colors.textMuted,
  },
  legend: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingTop: 4,
  },
  legendText: {
    fontFamily: "Inter_400Regular",
    fontSize: 10,
    color: Colors.textMuted,
  },
});


const exStyles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.90)",
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
    width: "88%",
    maxWidth: 420,
    gap: 16,
  },
  title: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 15,
    color: Colors.gold,
    letterSpacing: 2,
    textAlign: "center",
  },
  section: { gap: 10 },
  label: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.textSecondary,
  },
  singleCard: { alignItems: "center", paddingVertical: 4 },
  pickRow: { flexGrow: 0 },
  pickCardWrap: { marginRight: 8, paddingVertical: 4 },
  pickCardLifted: { transform: [{ translateY: -10 }] },
  confirmBtn: { borderRadius: 12, overflow: "hidden", marginTop: 4 },
  confirmBtnDim: { opacity: 0.5 },
  confirmGrad: { paddingVertical: 14, alignItems: "center" },
  confirmText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 16,
    color: "#0A1F18",
    letterSpacing: 0.5,
  },
  noCards: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.textMuted,
    alignSelf: "center",
    paddingVertical: 20,
  },
  aiChoosing: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: "center",
    paddingVertical: 10,
  },
  jokerEmoji: { fontSize: 40, textAlign: "center" },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
});
