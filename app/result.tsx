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
import { useGame } from "@/context/GameContext";
import { CardView } from "@/components/CardView";
import { sortHand } from "@/lib/gameEngine";
import Colors from "@/constants/colors";

const POSITION_MEDALS = ["trophy", "medal", "ribbon", "remove-circle"];
const POSITION_COLORS = [Colors.gold, "#C0C0C0", "#CD7F32", Colors.textMuted];
const POSITION_LABELS = ["1°", "2°", "3°", "4°"];

interface RankCardProps {
  rank: number;
  name: string;
  isWinner: boolean;
  delay: number;
  team?: "A" | "B";
}

function RankCard({ rank, name, isWinner, delay, team }: RankCardProps) {
  const opacity = useSharedValue(0);
  const translateX = useSharedValue(60);
  const scale = useSharedValue(0.9);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 400 }));
    translateX.value = withDelay(
      delay,
      withSpring(0, { damping: 15, stiffness: 200 })
    );
    scale.value = withDelay(
      delay,
      withSpring(1, { damping: 12, stiffness: 200 })
    );
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
        <LinearGradient
          colors={["rgba(201,168,76,0.15)", "transparent"]}
          style={StyleSheet.absoluteFill}
        />
      )}
      <View style={[styles.positionBadge, { borderColor: color }]}>
        <Text style={[styles.positionLabel, { color }]}>{label}</Text>
      </View>
      <Ionicons
        name={icon as React.ComponentProps<typeof Ionicons>["name"]}
        size={24}
        color={color}
      />
      <View style={{ flex: 1 }}>
        <Text style={styles.playerName}>{name}</Text>
        {team && (
          <Text
            style={[
              styles.teamLabel,
              { color: team === "A" ? Colors.accent : Colors.gold },
            ]}
          >
            Team {team}
          </Text>
        )}
      </View>
      {isWinner && (
        <View style={styles.winnerBadge}>
          <Text style={styles.winnerBadgeText}>VINCITORE</Text>
        </View>
      )}
    </Animated.View>
  );
}

function WinnerCelebration({ name }: { name: string }) {
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

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glow.value,
  }));

  return (
    <Animated.View style={[styles.celebration, containerStyle]}>
      <Animated.View style={[styles.celebrationGlow, glowStyle]} />
      <View style={styles.trophyCircle}>
        <LinearGradient
          colors={[Colors.gold, Colors.goldDark]}
          style={styles.trophyGradient}
        >
          <Ionicons name="trophy" size={44} color="#0A1F18" />
        </LinearGradient>
      </View>
      <Text style={styles.winnerName}>{name}</Text>
      <Text style={styles.winnerSubtitle}>Vincitore</Text>
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

  const exchangeCards = sortHand(winner.hand.filter(
    (c) => ["3","4","5","6","7","8","9","10"].includes(c.rank)
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
              onPress={() => { if (selectedId) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); chooseExchangeCard(selectedId); } }}
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

export default function ResultScreen() {
  const insets = useSafeAreaInsets();
  const { gameState, setupRematch, chooseExchangeCard, resetGame } = useGame();
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

  if (!gameState) {
    router.replace("/");
    return null;
  }

  const showExchange = gameState.exchangePhase?.active === true || gameState.exchangePhase?.bothJokersException === true;

  const sortedPlayers = [...gameState.players].sort(
    (a, b) => (a.finishPosition ?? 99) - (b.finishPosition ?? 99)
  );

  const winner = sortedPlayers[0];
  const isTeamMode = gameState.gameMode === "teams";
  const winnerTeam = isTeamMode ? winner.team : null;

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

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

  const displayName = isTeamMode && winnerTeam
    ? `Team ${winnerTeam}`
    : winner.name;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <LinearGradient
        colors={[Colors.bg, Colors.bgCard, Colors.bg]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Partita Finita</Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: bottomPad + 120 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <WinnerCelebration name={displayName} />

        <View style={styles.rankingSection}>
          <Text style={styles.rankingTitle}>CLASSIFICA</Text>
          <View style={styles.rankList}>
            {sortedPlayers.map((player, idx) => (
              <RankCard
                key={player.id}
                rank={idx}
                name={player.name}
                isWinner={idx === 0}
                delay={idx * 100 + 400}
                team={isTeamMode ? player.team : undefined}
              />
            ))}
          </View>
        </View>

        <View style={styles.statsSection}>
          <Text style={styles.statsTitle}>RIEPILOGO</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <Ionicons name="people" size={20} color={Colors.gold} />
              <Text style={styles.statValue}>{gameState.players.length}</Text>
              <Text style={styles.statLabel}>Giocatori</Text>
            </View>
            <View style={styles.statItem}>
              <Ionicons
                name={gameState.gameMode === "teams" ? "people-circle" : "person-circle"}
                size={20}
                color={Colors.gold}
              />
              <Text style={styles.statValue}>
                {gameState.gameMode === "teams" ? "Coppie" : "1 vs 1"}
              </Text>
              <Text style={styles.statLabel}>Modalità</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.actions, { paddingBottom: bottomPad + 16 }]}>
        <LinearGradient
          colors={["transparent", Colors.bg, Colors.bg]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <Pressable onPress={handleHome} style={styles.homeBtn}>
          <Ionicons name="home" size={18} color={Colors.textSecondary} />
          <Text style={styles.homeBtnText}>Home</Text>
        </Pressable>
        <Pressable onPress={handleRematch} style={styles.rematchBtn}>
          <LinearGradient
            colors={[Colors.gold, Colors.goldDark]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.rematchGradient}
          >
            <Ionicons name="refresh" size={18} color="#0A1F18" />
            <Text style={styles.rematchText}>Rivincita</Text>
          </LinearGradient>
        </Pressable>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    alignItems: "center",
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 22,
    color: Colors.text,
    letterSpacing: 2,
  },
  scroll: {
    padding: 20,
    gap: 32,
  },
  celebration: {
    alignItems: "center",
    gap: 12,
    paddingVertical: 20,
  },
  celebrationGlow: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: Colors.gold,
    top: 0,
    opacity: 0.08,
  },
  trophyCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: Colors.gold,
  },
  trophyGradient: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  winnerName: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 32,
    color: Colors.text,
    letterSpacing: 2,
  },
  winnerSubtitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: Colors.gold,
    letterSpacing: 3,
    textTransform: "uppercase",
  },
  rankingSection: {
    gap: 12,
  },
  rankingTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    color: Colors.textMuted,
    letterSpacing: 2,
  },
  rankList: {
    gap: 10,
  },
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
  rankCardWinner: {
    borderColor: Colors.gold,
  },
  positionBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  positionLabel: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 14,
  },
  playerName: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 17,
    color: Colors.text,
  },
  teamLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    marginTop: 2,
  },
  winnerBadge: {
    backgroundColor: Colors.goldMuted,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: Colors.goldDark,
  },
  winnerBadgeText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 10,
    color: Colors.gold,
    letterSpacing: 1,
  },
  statsSection: {
    gap: 12,
  },
  statsTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    color: Colors.textMuted,
    letterSpacing: 2,
  },
  statsGrid: {
    flexDirection: "row",
    gap: 10,
  },
  statItem: {
    flex: 1,
    backgroundColor: Colors.bgSurface,
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statValue: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 20,
    color: Colors.text,
  },
  statLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.textMuted,
  },
  actions: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
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
  homeBtnText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 16,
    color: Colors.textSecondary,
  },
  rematchBtn: {
    flex: 1,
    borderRadius: 14,
    overflow: "hidden",
  },
  rematchGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
  },
  rematchText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 17,
    color: "#0A1F18",
    letterSpacing: 0.5,
  },
});

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
  section: {
    gap: 10,
  },
  label: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.textSecondary,
  },
  singleCard: {
    alignItems: "center",
    paddingVertical: 4,
  },
  pickRow: {
    flexGrow: 0,
  },
  pickCardWrap: {
    marginRight: 8,
    paddingVertical: 4,
  },
  pickCardLifted: {
    transform: [{ translateY: -10 }],
  },
  confirmBtn: {
    borderRadius: 12,
    overflow: "hidden",
    marginTop: 4,
  },
  confirmBtnDim: {
    opacity: 0.5,
  },
  confirmGrad: {
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
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
  jokerRow: {
    alignItems: "center",
    paddingVertical: 8,
  },
  jokerEmoji: {
    fontSize: 44,
  },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
});
