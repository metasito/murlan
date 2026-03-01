import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  Platform,
  Dimensions,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  withSequence,
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
  Combination,
  sortHand,
  Player,
} from "@/lib/gameEngine";
import Colors from "@/constants/colors";

const { width: SCREEN_W } = Dimensions.get("window");
const AI_DELAY = 1100;

function CombinationLabel({ combo }: { combo: Combination | null }) {
  if (!combo) return null;
  const labels: Record<string, string> = {
    single: "Singola",
    pair: "Coppia",
    triple: "Tris",
    straight: "Scala",
  };
  return (
    <View style={styles.comboChip}>
      <Text style={styles.comboChipText}>
        {labels[combo.type]}
        {combo.cards.length > 2 ? ` x${combo.cards.length}` : ""}
      </Text>
    </View>
  );
}

function OpponentBadge({
  player,
  isActive,
}: {
  player: Player;
  isActive: boolean;
}) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (isActive) {
      pulse.value = withSequence(
        withTiming(1.08, { duration: 350 }),
        withTiming(1, { duration: 350 })
      );
    }
  }, [isActive]);
  const pStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  const isFinished = player.finishPosition !== undefined;

  const displayCards = Math.min(player.hand.length, 6);

  return (
    <Animated.View style={[styles.opponentBadge, isActive && styles.opponentBadgeActive, pStyle]}>
      <View style={styles.opponentInfo}>
        <View style={[styles.opponentDot, { backgroundColor: isActive ? Colors.gold : "transparent" }]} />
        <Text style={styles.opponentName} numberOfLines={1}>{player.name}</Text>
        {isFinished ? (
          <View style={styles.finishBadge}>
            <Ionicons name="trophy" size={9} color={Colors.gold} />
            <Text style={styles.finishBadgeText}>#{player.finishPosition}</Text>
          </View>
        ) : (
          <Text style={styles.opponentCount}>{player.hand.length}</Text>
        )}
      </View>
      <View style={styles.miniHand}>
        {isFinished ? null : Array.from({ length: displayCards }, (_, i) => (
          <View
            key={i}
            style={[
              styles.miniCard,
              {
                marginLeft: i > 0 ? -14 : 0,
                transform: [
                  { rotate: `${(i - (displayCards - 1) / 2) * 5}deg` },
                  { translateY: Math.abs(i - (displayCards - 1) / 2) * 1.5 },
                ],
                zIndex: i,
              },
            ]}
          >
            <CardView
              card={{ id: `back_${i}`, suit: null, rank: "3", isJoker: false }}
              faceDown
              small
            />
          </View>
        ))}
      </View>
    </Animated.View>
  );
}

function PlayedCardsCenter({
  combo,
  roundWinnerName,
}: {
  combo: Combination | null;
  roundWinnerName: string | null;
}) {
  const scale = useSharedValue(0.7);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (combo) {
      scale.value = withSpring(1, { damping: 12, stiffness: 200 });
      opacity.value = withTiming(1, { duration: 250 });
    } else {
      scale.value = withTiming(0.8, { duration: 200 });
      opacity.value = withTiming(0, { duration: 200 });
    }
  }, [combo]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <View style={styles.centerTable}>
      <View style={styles.tableEllipse}>
        <LinearGradient
          colors={[Colors.feltLight, Colors.felt, Colors.feltDark]}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.tableEllipseBorder} />

        {roundWinnerName && (
          <Animated.View
            entering={FadeIn.duration(300)}
            exiting={FadeOut.duration(300)}
            style={styles.roundWinnerBanner}
          >
            <Ionicons name="star" size={10} color={Colors.gold} />
            <Text style={styles.roundWinnerText}>{roundWinnerName}</Text>
          </Animated.View>
        )}

        {combo ? (
          <Animated.View style={[styles.playedStack, animStyle]}>
            <CombinationLabel combo={combo} />
            <View style={styles.playedCards}>
              {combo.cards.map((card, i) => {
                const total = combo.cards.length;
                const angle = (i - (total - 1) / 2) * 6;
                const offsetY = Math.abs(i - (total - 1) / 2) * 2;
                return (
                  <View
                    key={card.id}
                    style={[
                      styles.playedCardWrap,
                      {
                        marginLeft: i > 0 ? -18 : 0,
                        transform: [{ rotate: `${angle}deg` }, { translateY: offsetY }],
                        zIndex: i,
                      },
                    ]}
                  >
                    <CardView card={card} />
                  </View>
                );
              })}
            </View>
          </Animated.View>
        ) : (
          <View style={styles.emptyTableHint}>
            <Text style={styles.emptyTableText}>Inizia il round</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function FanHand({
  cards,
  selectedIds,
  onCardPress,
  disabled,
}: {
  cards: ReturnType<typeof sortHand>;
  selectedIds: string[];
  onCardPress: (id: string) => void;
  disabled: boolean;
}) {
  const total = cards.length;
  if (total === 0) {
    return (
      <View style={styles.emptyHand}>
        <Ionicons name="checkmark-circle" size={28} color={Colors.gold} />
        <Text style={styles.emptyHandText}>Carte finite!</Text>
      </View>
    );
  }

  const CARD_W = 58;
  const MAX_SPREAD = SCREEN_W - 80;
  const OVERLAP = Math.max(18, Math.min(38, (total * CARD_W - MAX_SPREAD) / Math.max(total - 1, 1)));
  const effectiveStep = CARD_W - OVERLAP;
  const totalWidth = effectiveStep * (total - 1) + CARD_W;
  const maxAngle = Math.min(30, total * 2.5);

  return (
    <View style={styles.fanContainer}>
      <View style={[styles.fanRow, { width: Math.min(totalWidth, MAX_SPREAD + CARD_W) }]}>
        {cards.map((card, i) => {
          const center = (total - 1) / 2;
          const angle = ((i - center) / Math.max(center, 1)) * maxAngle;
          const arcRise = Math.abs(i - center) * 3;
          const isSelected = selectedIds.includes(card.id);

          return (
            <View
              key={card.id}
              style={[
                styles.fanCardWrap,
                {
                  left: i * effectiveStep,
                  transform: [
                    { rotate: `${angle}deg` },
                    { translateY: arcRise },
                  ],
                  zIndex: isSelected ? total + 10 : i,
                },
              ]}
            >
              <CardView
                card={card}
                selected={isSelected}
                onPress={() => onCardPress(card.id)}
                disabled={disabled}
              />
            </View>
          );
        })}
      </View>
    </View>
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

  const runAITurnRef = useRef(runAITurn);
  runAITurnRef.current = runAITurn;

  const [roundWinnerName, setRoundWinnerName] = useState<string | null>(null);

  useEffect(() => {
    if (!gameState) return;
    if (gameState.gameOver) {
      setTimeout(() => router.replace("/result"), 1000);
      return;
    }
    const currentPlayer = gameState.players[gameState.currentTurnIndex];
    if (currentPlayer.type === "ai") {
      const timer = setTimeout(() => {
        runAITurnRef.current();
      }, AI_DELAY);
      return () => clearTimeout(timer);
    }
  }, [
    gameState?.currentTurnIndex,
    gameState?.gameOver,
    gameState?.passCount,
    gameState?.lastPlayedCombination,
  ]);

  useEffect(() => {
    if (lastRoundWinner !== null && gameState) {
      const name = gameState.players[lastRoundWinner]?.name ?? "";
      setRoundWinnerName(name);
      const t = setTimeout(() => setRoundWinnerName(null), 1800);
      return () => clearTimeout(t);
    }
  }, [lastRoundWinner]);

  if (!gameState) {
    router.replace("/");
    return null;
  }

  const humanIdx = gameState.players.findIndex((p) => p.type === "human");
  const humanPlayer = gameState.players[humanIdx];
  const currentPlayer = gameState.players[gameState.currentTurnIndex];
  const isHumanTurn = gameState.currentTurnIndex === humanIdx;
  const isNewRound = gameState.lastPlayedCombination === null;
  const isFinished = humanPlayer?.finishPosition !== undefined;

  const sortedHand = sortHand(humanPlayer?.hand ?? []);
  const selectedObjs = sortedHand.filter((c) => selectedCards.includes(c.id));
  const tentativeCombo = selectedObjs.length > 0 ? buildCombination(selectedObjs) : null;
  const isValidPlay =
    tentativeCombo !== null &&
    canPlay(tentativeCombo, isNewRound ? null : gameState.lastPlayedCombination);
  const canPassNow = !isNewRound && isHumanTurn && !isFinished;

  const opponents = gameState.players.filter((_, i) => i !== humanIdx);

  const handlePlay = () => {
    if (!isValidPlay || !isHumanTurn) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    playSelected();
  };

  const handlePass = () => {
    if (!canPassNow) return;
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

  const handleCardPress = (id: string) => {
    if (!isHumanTurn || isFinished) return;
    Haptics.selectionAsync();
    selectCard(id);
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const playBtnValid = isValidPlay && isHumanTurn && !isFinished;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <LinearGradient
        colors={["#072A18", "#0B3B25", "#062012"]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.topBar}>
        <Pressable onPress={handleQuit} style={styles.quitBtn} hitSlop={12}>
          <Ionicons name="close" size={18} color="rgba(240,234,214,0.5)" />
        </Pressable>

        <View style={styles.turnIndicator}>
          <View style={[styles.turnDot, { backgroundColor: isHumanTurn ? Colors.gold : Colors.accent }]} />
          <Text style={styles.turnText} numberOfLines={1}>
            {isHumanTurn
              ? isFinished ? "Aspetti gli altri..." : "Il tuo turno"
              : `${currentPlayer.name} pensa...`}
          </Text>
        </View>

        <View style={styles.cardCountBadge}>
          <Text style={styles.cardCountText}>{humanPlayer?.hand.length ?? 0}</Text>
        </View>
      </View>

      <View style={styles.opponentsRow}>
        {opponents.map((opp) => (
          <OpponentBadge
            key={opp.id}
            player={opp}
            isActive={gameState.players.indexOf(opp) === gameState.currentTurnIndex}
          />
        ))}
      </View>

      <PlayedCardsCenter
        combo={gameState.lastPlayedCombination}
        roundWinnerName={roundWinnerName}
      />

      <View style={[styles.playerArea, { paddingBottom: bottomPad + 10 }]}>
        {isFinished ? (
          <View style={styles.finishedBanner}>
            <Ionicons name="trophy" size={18} color={Colors.gold} />
            <Text style={styles.finishedText}>
              Hai finito #{humanPlayer?.finishPosition}! Aspetti gli altri...
            </Text>
          </View>
        ) : (
          <FanHand
            cards={sortedHand}
            selectedIds={selectedCards}
            onCardPress={handleCardPress}
            disabled={!isHumanTurn}
          />
        )}

        <View style={styles.actionRow}>
          <Pressable
            onPress={handlePass}
            disabled={!canPassNow}
            style={[styles.passBtn, !canPassNow && styles.btnDisabled]}
          >
            <Ionicons name="arrow-undo" size={16} color={canPassNow ? Colors.textSecondary : Colors.textMuted} />
            <Text style={[styles.passBtnText, !canPassNow && { color: Colors.textMuted }]}>
              Passa
            </Text>
          </Pressable>

          <Pressable
            onPress={handlePlay}
            disabled={!playBtnValid}
            style={[styles.playBtn, !playBtnValid && styles.playBtnDisabled]}
          >
            {playBtnValid ? (
              <LinearGradient
                colors={[Colors.goldLight, Colors.gold, Colors.goldDark]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.playBtnInner}
              >
                <Ionicons name="play" size={16} color="#0A1F18" />
                <Text style={styles.playBtnTextActive}>
                  {tentativeCombo
                    ? `Gioca${selectedCards.length > 1 ? ` (${selectedCards.length})` : ""}`
                    : "Gioca"}
                </Text>
              </LinearGradient>
            ) : (
              <View style={styles.playBtnInner}>
                <Ionicons name="play" size={16} color={Colors.textMuted} />
                <Text style={styles.playBtnTextDim}>
                  {!isHumanTurn || isFinished
                    ? "—"
                    : selectedCards.length === 0
                    ? "Seleziona carte"
                    : tentativeCombo === null
                    ? "Combinazione invalida"
                    : !isValidPlay
                    ? "Carta troppo bassa"
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
  container: { flex: 1, backgroundColor: "#072A18" },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  quitBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(0,0,0,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  turnIndicator: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "rgba(0,0,0,0.2)",
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  turnDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  turnText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 14,
    color: Colors.text,
    letterSpacing: 0.3,
  },
  cardCountBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(0,0,0,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  cardCountText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 16,
    color: Colors.gold,
  },

  opponentsRow: {
    flexDirection: "row",
    justifyContent: "center",
    flexWrap: "wrap",
    paddingHorizontal: 12,
    gap: 8,
    paddingVertical: 6,
  },
  opponentBadge: {
    backgroundColor: "rgba(0,0,0,0.25)",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
    minWidth: 90,
  },
  opponentBadgeActive: {
    borderColor: Colors.gold,
    backgroundColor: "rgba(201,168,76,0.12)",
  },
  opponentInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  opponentDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  opponentName: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 12,
    color: Colors.text,
    maxWidth: 65,
  },
  opponentCount: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 12,
    color: Colors.textMuted,
  },
  finishBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  finishBadgeText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 10,
    color: Colors.gold,
  },
  miniHand: {
    flexDirection: "row",
    alignItems: "flex-end",
    height: 58,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  miniCard: {},

  centerTable: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  tableEllipse: {
    width: SCREEN_W * 0.78,
    height: SCREEN_W * 0.55,
    borderRadius: SCREEN_W * 0.35,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(201,168,76,0.2)",
  },
  tableEllipseBorder: {
    position: "absolute",
    top: 6,
    left: 6,
    right: 6,
    bottom: 6,
    borderRadius: SCREEN_W * 0.35,
    borderWidth: 1,
    borderColor: "rgba(201,168,76,0.12)",
  },
  roundWinnerBanner: {
    position: "absolute",
    top: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: Colors.goldMuted,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: Colors.goldDark,
  },
  roundWinnerText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 12,
    color: Colors.gold,
  },
  playedStack: {
    alignItems: "center",
    gap: 8,
  },
  comboChip: {
    backgroundColor: "rgba(201,168,76,0.2)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "rgba(201,168,76,0.4)",
  },
  comboChipText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 11,
    color: Colors.gold,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  playedCards: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
  },
  playedCardWrap: {},
  emptyTableHint: {
    alignItems: "center",
    gap: 4,
  },
  emptyTableText: {
    fontFamily: "Rajdhani_500Medium",
    fontSize: 15,
    color: "rgba(240,234,214,0.2)",
  },

  playerArea: {
    backgroundColor: "rgba(0,0,0,0.3)",
    borderTopWidth: 1,
    borderTopColor: "rgba(201,168,76,0.15)",
    paddingTop: 14,
    gap: 12,
  },

  fanContainer: {
    height: 100,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  fanRow: {
    position: "relative",
    height: 90,
    alignSelf: "center",
  },
  fanCardWrap: {
    position: "absolute",
    bottom: 0,
  },

  emptyHand: {
    height: 90,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  emptyHandText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 15,
    color: Colors.gold,
  },

  finishedBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    marginHorizontal: 16,
    backgroundColor: Colors.goldMuted,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.goldDark,
  },
  finishedText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 14,
    color: Colors.gold,
  },

  actionRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
  },
  passBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 18,
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
  },
  playBtnDisabled: {
    opacity: 0.55,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },
  playBtnInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  playBtnTextActive: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 16,
    color: "#0A1F18",
    letterSpacing: 0.5,
  },
  playBtnTextDim: {
    fontFamily: "Rajdhani_500Medium",
    fontSize: 14,
    color: Colors.textMuted,
  },
  btnDisabled: { opacity: 0.45 },
});
