import React, { useEffect, useRef, useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  withSequence,
  withDelay,
  runOnJS,
  FadeIn,
  FadeOut,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useGame } from "@/context/GameContext";
import { CardView } from "@/components/CardView";
import {
  buildCombination,
  canPlay,
  Card,
  Combination,
  getCombinationType,
  sortHand,
} from "@/lib/gameEngine";
import Colors from "@/constants/colors";

const AI_DELAY = 1200;

function CombinationLabel({ combination }: { combination: Combination | null }) {
  if (!combination) return null;
  const labels: Record<string, string> = {
    single: "Singola",
    pair: "Coppia",
    triple: "Tris",
    straight: "Scala",
  };
  return (
    <Text style={styles.comboLabel}>
      {labels[combination.type]} {combination.cards.length > 1 ? `x${combination.cards.length}` : ""}
    </Text>
  );
}

function OpponentHand({
  count,
  name,
  isActive,
  position,
  finishPosition,
}: {
  count: number;
  name: string;
  isActive: boolean;
  position: "top" | "left" | "right";
  finishPosition?: number;
}) {
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (isActive) {
      pulse.value = withSequence(
        withTiming(1.06, { duration: 400 }),
        withTiming(1, { duration: 400 })
      );
    }
  }, [isActive]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  const displayCount = Math.min(count, 7);
  const isFinished = finishPosition !== undefined;

  return (
    <Animated.View
      style={[
        styles.opponentContainer,
        position === "top" && styles.opponentTop,
        position === "left" && styles.opponentLeft,
        position === "right" && styles.opponentRight,
        pulseStyle,
      ]}
    >
      <View
        style={[
          styles.opponentNameBadge,
          isActive && styles.opponentNameActive,
          isFinished && styles.opponentNameFinished,
        ]}
      >
        {isActive && !isFinished && (
          <View style={styles.activeDot} />
        )}
        {isFinished && (
          <Ionicons name="trophy" size={10} color={Colors.gold} />
        )}
        <Text style={styles.opponentName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.cardCount}>{count}</Text>
      </View>
      <View
        style={[
          styles.opponentHand,
          position === "left" || position === "right"
            ? styles.opponentHandVertical
            : styles.opponentHandHorizontal,
        ]}
      >
        {isFinished ? (
          <View style={styles.finishedBadge}>
            <Text style={styles.finishedText}>#{finishPosition}</Text>
          </View>
        ) : (
          Array.from({ length: displayCount }, (_, i) => (
            <View
              key={i}
              style={[
                styles.stackedCard,
                { marginLeft: i > 0 ? (position === "top" ? -22 : 0) : 0 },
                { marginTop: i > 0 && position !== "top" ? -28 : 0 },
              ]}
            >
              <CardView
                card={{ id: `back_${i}`, suit: null, rank: "3", isJoker: false }}
                faceDown
                small
              />
            </View>
          ))
        )}
      </View>
    </Animated.View>
  );
}

function CenterArea({
  combination,
  roundWinner,
  winnerName,
}: {
  combination: Combination | null;
  roundWinner: number | null;
  winnerName?: string;
}) {
  const scale = useSharedValue(0.8);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (combination) {
      scale.value = withSpring(1, { damping: 12, stiffness: 200 });
      opacity.value = withTiming(1, { duration: 200 });
    } else {
      scale.value = withTiming(0.85, { duration: 200 });
      opacity.value = withTiming(0, { duration: 200 });
    }
  }, [combination]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <View style={styles.centerArea}>
      {roundWinner !== null && winnerName && (
        <Animated.View
          entering={FadeIn.duration(300)}
          exiting={FadeOut.duration(300)}
          style={styles.roundWinnerBadge}
        >
          <Ionicons name="star" size={12} color={Colors.gold} />
          <Text style={styles.roundWinnerText}>{winnerName} vince il round</Text>
        </Animated.View>
      )}

      {combination && (
        <Animated.View style={[styles.playedCardsContainer, animStyle]}>
          <CombinationLabel combination={combination} />
          <View style={styles.playedCards}>
            {combination.cards.map((card, i) => (
              <View
                key={card.id}
                style={[
                  styles.playedCard,
                  { marginLeft: i > 0 ? -10 : 0 },
                  {
                    transform: [
                      {
                        rotate: `${(i - (combination.cards.length - 1) / 2) * 4}deg`,
                      },
                    ],
                  },
                ]}
              >
                <CardView card={card} />
              </View>
            ))}
          </View>
        </Animated.View>
      )}

      {!combination && (
        <View style={styles.emptyCenter}>
          <Text style={styles.emptyCenterText}>Nessuna carta giocata</Text>
          <Text style={styles.emptyCenterSub}>Inizia il round</Text>
        </View>
      )}
    </View>
  );
}

function TurnBanner({ name, isHuman }: { name: string; isHuman: boolean }) {
  const translateY = useSharedValue(-20);
  const opacity = useSharedValue(0);

  useEffect(() => {
    translateY.value = withSpring(0, { damping: 15 });
    opacity.value = withTiming(1, { duration: 300 });
  }, [name]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[styles.turnBanner, style]}>
      <View
        style={[styles.turnDot, { backgroundColor: isHuman ? Colors.gold : Colors.accent }]}
      />
      <Text style={styles.turnText}>
        {isHuman ? "Il tuo turno" : `${name} sta pensando...`}
      </Text>
    </Animated.View>
  );
}

export default function GameScreen() {
  const insets = useSafeAreaInsets();
  const {
    gameState,
    selectedCards,
    lastRoundWinner,
    selectCard,
    playSelected,
    passTurn,
    resetGame,
    runAITurn,
  } = useGame();

  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showRoundWinner, setShowRoundWinner] = useState(false);

  useEffect(() => {
    if (!gameState) return;

    if (gameState.gameOver) {
      if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
      setTimeout(() => router.replace("/result"), 1200);
      return;
    }

    const currentPlayer = gameState.players[gameState.currentTurnIndex];
    if (currentPlayer.type === "ai") {
      aiTimerRef.current = setTimeout(() => {
        runAITurn();
      }, AI_DELAY);
    }

    return () => {
      if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    };
  }, [gameState?.currentTurnIndex, gameState?.gameOver, gameState?.lastPlayedCombination]);

  useEffect(() => {
    if (lastRoundWinner !== null) {
      setShowRoundWinner(true);
      setTimeout(() => setShowRoundWinner(false), 1500);
    }
  }, [lastRoundWinner]);

  if (!gameState) {
    router.replace("/");
    return null;
  }

  const humanPlayerIndex = gameState.players.findIndex(
    (p) => p.type === "human"
  );
  const humanPlayer = gameState.players[humanPlayerIndex];
  const currentPlayer = gameState.players[gameState.currentTurnIndex];
  const isHumanTurn = gameState.currentTurnIndex === humanPlayerIndex;
  const isNewRound = gameState.lastPlayedCombination === null;

  const sortedHand = sortHand(humanPlayer?.hand ?? []);

  const selectedCardObjects = sortedHand.filter((c) =>
    selectedCards.includes(c.id)
  );
  const tentativeCombo =
    selectedCardObjects.length > 0
      ? buildCombination(selectedCardObjects)
      : null;
  const isValidPlay =
    tentativeCombo !== null &&
    canPlay(tentativeCombo, isNewRound ? null : gameState.lastPlayedCombination);
  const canPass = !isNewRound && isHumanTurn;
  const isFinished = humanPlayer?.finishPosition !== undefined;

  const handlePlay = () => {
    if (!isValidPlay) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    playSelected();
  };

  const handlePass = () => {
    if (!canPass) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    passTurn();
  };

  const handleQuit = () => {
    Alert.alert("Abbandona", "Vuoi uscire dalla partita?", [
      { text: "Annulla", style: "cancel" },
      {
        text: "Esci",
        style: "destructive",
        onPress: () => {
          resetGame();
          router.replace("/");
        },
      },
    ]);
  };

  const opponents = gameState.players.filter((_, i) => i !== humanPlayerIndex);
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const getOpponentPosition = (
    idx: number,
    total: number
  ): "top" | "left" | "right" => {
    if (total === 1) return "top";
    if (total === 2) return idx === 0 ? "left" : "right";
    if (total === 3) {
      if (idx === 0) return "left";
      if (idx === 1) return "top";
      return "right";
    }
    return "top";
  };

  const roundWinnerName =
    lastRoundWinner !== null
      ? gameState.players[lastRoundWinner]?.name
      : undefined;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <LinearGradient
        colors={[Colors.feltDark, Colors.felt, Colors.feltDark]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.feltOverlay} />

      <View style={styles.topBar}>
        <Pressable onPress={handleQuit} style={styles.quitBtn}>
          <Ionicons name="close" size={20} color={Colors.textSecondary} />
        </Pressable>
        <View style={styles.statusChip}>
          <Text style={styles.statusText}>
            {isHumanTurn ? "Il tuo turno" : currentPlayer.name}
          </Text>
        </View>
        <View style={styles.handCount}>
          <Ionicons name="layers" size={14} color={Colors.textMuted} />
          <Text style={styles.handCountText}>
            {humanPlayer?.hand.length ?? 0}
          </Text>
        </View>
      </View>

      <View style={styles.tableArea}>
        <View style={styles.opponentsArea}>
          {opponents.map((opp, idx) => {
            const originalIdx = gameState.players.indexOf(opp);
            return (
              <OpponentHand
                key={opp.id}
                count={opp.hand.length}
                name={opp.name}
                isActive={gameState.currentTurnIndex === originalIdx}
                position={getOpponentPosition(idx, opponents.length)}
                finishPosition={opp.finishPosition}
              />
            );
          })}
        </View>

        <CenterArea
          combination={gameState.lastPlayedCombination}
          roundWinner={showRoundWinner ? lastRoundWinner : null}
          winnerName={roundWinnerName}
        />
      </View>

      {!isFinished && (
        <TurnBanner name={currentPlayer.name} isHuman={isHumanTurn} />
      )}

      {isFinished && humanPlayer?.finishPosition !== undefined && (
        <View style={styles.finishedBanner}>
          <Ionicons name="trophy" size={16} color={Colors.gold} />
          <Text style={styles.finishedBannerText}>
            Hai finito #{humanPlayer.finishPosition}! In attesa degli altri...
          </Text>
        </View>
      )}

      <View style={[styles.playerArea, { paddingBottom: bottomPad + 8 }]}>
        <View style={styles.handWrapper}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.handScroll}
            scrollEnabled={sortedHand.length > 0}
          >
            {sortedHand.map((card) => (
              <CardView
                key={card.id}
                card={card}
                selected={selectedCards.includes(card.id)}
                onPress={() => {
                  if (!isHumanTurn || isFinished) return;
                  Haptics.selectionAsync();
                  selectCard(card.id);
                }}
                disabled={!isHumanTurn || isFinished}
              />
            ))}
          </ScrollView>
        </View>

        <View style={styles.actionRow}>
          <Pressable
            onPress={handlePass}
            disabled={!canPass}
            style={[styles.passBtn, !canPass && styles.btnDisabled]}
          >
            <Ionicons
              name="arrow-forward"
              size={16}
              color={canPass ? Colors.textSecondary : Colors.textMuted}
            />
            <Text
              style={[
                styles.passBtnText,
                !canPass && { color: Colors.textMuted },
              ]}
            >
              Passa
            </Text>
          </Pressable>

          <Pressable
            onPress={handlePlay}
            disabled={!isValidPlay || !isHumanTurn}
            style={[styles.playBtn, (!isValidPlay || !isHumanTurn) && styles.btnDisabled]}
          >
            {isValidPlay && isHumanTurn ? (
              <LinearGradient
                colors={[Colors.gold, Colors.goldDark]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.playBtnGradient}
              >
                <Ionicons name="play" size={16} color="#0A1F18" />
                <Text style={styles.playBtnTextActive}>
                  {tentativeCombo
                    ? `Gioca ${tentativeCombo.cards.length > 1 ? `(${tentativeCombo.cards.length})` : ""}`
                    : "Gioca"}
                </Text>
              </LinearGradient>
            ) : (
              <View style={styles.playBtnGradient}>
                <Ionicons name="play" size={16} color={Colors.textMuted} />
                <Text style={styles.playBtnText}>
                  {selectedCards.length === 0
                    ? "Seleziona"
                    : tentativeCombo === null
                    ? "Combinazione non valida"
                    : !isValidPlay
                    ? "Troppo bassa"
                    : "Gioca"}
                </Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.felt,
  },
  feltOverlay: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.3,
    backgroundColor: "transparent",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  quitBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  statusChip: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.2)",
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  statusText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 14,
    color: Colors.text,
    letterSpacing: 0.5,
  },
  handCount: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.2)",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  handCountText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 14,
    color: Colors.textSecondary,
  },
  tableArea: {
    flex: 1,
    position: "relative",
  },
  opponentsArea: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 140,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-around",
    paddingHorizontal: 16,
  },
  opponentContainer: {
    alignItems: "center",
    gap: 6,
  },
  opponentTop: {},
  opponentLeft: {},
  opponentRight: {},
  opponentNameBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.3)",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  opponentNameActive: {
    borderColor: Colors.gold,
    backgroundColor: "rgba(201,168,76,0.15)",
  },
  opponentNameFinished: {
    borderColor: Colors.gold,
    backgroundColor: "rgba(201,168,76,0.1)",
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.gold,
  },
  opponentName: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 12,
    color: Colors.text,
    maxWidth: 70,
  },
  cardCount: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 12,
    color: Colors.textMuted,
  },
  opponentHand: {
    alignItems: "center",
  },
  opponentHandHorizontal: {
    flexDirection: "row",
  },
  opponentHandVertical: {
    flexDirection: "column",
  },
  stackedCard: {},
  finishedBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.goldMuted,
    borderWidth: 1.5,
    borderColor: Colors.gold,
    alignItems: "center",
    justifyContent: "center",
  },
  finishedText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 14,
    color: Colors.gold,
  },
  centerArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 100,
    paddingBottom: 20,
  },
  roundWinnerBadge: {
    position: "absolute",
    top: 110,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.goldMuted,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.goldDark,
  },
  roundWinnerText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 13,
    color: Colors.gold,
  },
  playedCardsContainer: {
    alignItems: "center",
    gap: 10,
  },
  comboLabel: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 13,
    color: Colors.gold,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  playedCards: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  playedCard: {
    zIndex: 1,
  },
  emptyCenter: {
    alignItems: "center",
    gap: 6,
  },
  emptyCenterText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 16,
    color: "rgba(240,234,214,0.3)",
  },
  emptyCenterSub: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "rgba(240,234,214,0.2)",
  },
  turnBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 8,
    marginHorizontal: 16,
    backgroundColor: "rgba(0,0,0,0.25)",
    borderRadius: 10,
    marginBottom: 8,
  },
  turnDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  turnText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 14,
    color: Colors.textSecondary,
    letterSpacing: 0.5,
  },
  finishedBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 8,
    marginHorizontal: 16,
    backgroundColor: Colors.goldMuted,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.goldDark,
  },
  finishedBannerText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 13,
    color: Colors.gold,
  },
  playerArea: {
    backgroundColor: "rgba(0,0,0,0.35)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    paddingTop: 12,
    gap: 12,
  },
  handWrapper: {
    height: 96,
    justifyContent: "center",
  },
  handScroll: {
    paddingHorizontal: 16,
    gap: 6,
    alignItems: "flex-end",
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
  },
  passBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  passBtnText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 15,
    color: Colors.textSecondary,
  },
  playBtn: {
    flex: 1,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  playBtnGradient: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  playBtnText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 15,
    color: Colors.textMuted,
  },
  playBtnTextActive: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 15,
    color: "#0A1F18",
  },
  btnDisabled: {
    opacity: 0.6,
  },
});
