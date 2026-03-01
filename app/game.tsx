import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  Platform,
  useWindowDimensions,
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
  Card,
} from "@/lib/gameEngine";
import Colors from "@/constants/colors";

const AI_DELAY = 1100;
const HUMAN_TURN_SECONDS = 20;

function getOpponentPosition(
  clockwiseSteps: number,
  totalOpponents: number
): "top" | "left" | "right" {
  if (totalOpponents === 1) return "top";
  if (totalOpponents === 2) {
    return clockwiseSteps === 1 ? "right" : "left";
  }
  if (clockwiseSteps === 1) return "right";
  if (clockwiseSteps === 2) return "top";
  return "left";
}

function CombinationLabel({ combo }: { combo: Combination }) {
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

function TimerRing({
  seconds,
  total,
  active,
}: {
  seconds: number;
  total: number;
  active: boolean;
}) {
  if (!active) return null;
  const pct = seconds / total;
  const urgent = seconds <= 5;
  const size = 34;
  const stroke = 3;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = circ * pct;

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          position: "absolute",
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: stroke,
          borderColor: "rgba(255,255,255,0.1)",
        }}
      />
      <View
        style={{
          position: "absolute",
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: stroke,
          borderColor: urgent ? "#FF5252" : Colors.gold,
          borderTopColor: "transparent",
          borderRightColor: pct > 0.25 ? (urgent ? "#FF5252" : Colors.gold) : "transparent",
          borderBottomColor: pct > 0.5 ? (urgent ? "#FF5252" : Colors.gold) : "transparent",
          borderLeftColor: pct > 0.75 ? (urgent ? "#FF5252" : Colors.gold) : "transparent",
        }}
      />
      <Text
        style={{
          fontFamily: "Rajdhani_700Bold",
          fontSize: 12,
          color: urgent ? "#FF5252" : Colors.gold,
        }}
      >
        {seconds}
      </Text>
    </View>
  );
}

function OpponentBadge({
  player,
  isActive,
  position,
}: {
  player: Player;
  isActive: boolean;
  position: "top" | "left" | "right";
}) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (isActive) {
      pulse.value = withSequence(
        withTiming(1.06, { duration: 350 }),
        withTiming(1, { duration: 350 })
      );
    }
  }, [isActive]);
  const pStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  const isFinished = player.finishPosition !== undefined;
  const displayCards = Math.min(player.hand.length, 5);
  const isVertical = position === "left" || position === "right";

  return (
    <Animated.View
      style={[
        styles.opponentBadge,
        isActive && styles.opponentBadgeActive,
        isVertical && styles.opponentBadgeVertical,
        pStyle,
      ]}
    >
      <View style={styles.opponentInfo}>
        <View
          style={[styles.opponentDot, { backgroundColor: isActive ? Colors.gold : "transparent" }]}
        />
        <Text style={styles.opponentName} numberOfLines={1}>
          {player.name}
        </Text>
        {isFinished ? (
          <View style={styles.finishBadge}>
            <Ionicons name="trophy" size={9} color={Colors.gold} />
            <Text style={styles.finishBadgeText}>#{player.finishPosition}</Text>
          </View>
        ) : (
          <Text style={styles.opponentCount}>{player.hand.length}</Text>
        )}
      </View>

      {!isFinished && (
        <View
          style={[
            styles.miniHand,
            isVertical && styles.miniHandVertical,
          ]}
        >
          {Array.from({ length: displayCards }, (_, i) => (
            <View
              key={i}
              style={[
                isVertical ? styles.miniCardVertical : styles.miniCardHorizontal,
                {
                  marginTop: isVertical && i > 0 ? -22 : 0,
                  marginLeft: !isVertical && i > 0 ? -16 : 0,
                  transform: isVertical
                    ? [{ rotate: `${(i - (displayCards - 1) / 2) * 4}deg` }]
                    : [{ rotate: `${(i - (displayCards - 1) / 2) * 5}deg` }],
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
      )}
    </Animated.View>
  );
}

function PlayedPile({
  history,
  roundWinnerName,
  tableW,
  tableH,
}: {
  history: Combination[];
  roundWinnerName: string | null;
  tableW: number;
  tableH: number;
}) {
  const topCombo = history.length > 0 ? history[history.length - 1] : null;

  return (
    <View style={[styles.tableEllipse, { width: tableW, height: tableH, borderRadius: tableW * 0.45 }]}>
      <LinearGradient
        colors={[Colors.feltLight, Colors.felt, Colors.feltDark]}
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[
          styles.tableEllipseBorder,
          { borderRadius: tableW * 0.45 },
        ]}
      />

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

      {history.length === 0 && (
        <Text style={styles.emptyTableText}>Inizia il round</Text>
      )}

      {history.length > 0 && (
        <View style={styles.pileContainer}>
          {history.slice(-4).map((combo, stackIdx, arr) => {
            const isTop = stackIdx === arr.length - 1;
            const stackOffset = (stackIdx - (arr.length - 1)) * 4;
            const baseRotate = (stackIdx * 7 - 10) % 15;
            return (
              <View
                key={`pile_${stackIdx}`}
                style={[
                  styles.pileLayer,
                  {
                    transform: [
                      { rotate: `${baseRotate}deg` },
                      { translateY: stackOffset },
                    ],
                    zIndex: stackIdx,
                    opacity: isTop ? 1 : 0.55 + stackIdx * 0.1,
                  },
                ]}
              >
                <View style={styles.playedCardsRow}>
                  {combo.cards.slice(0, 5).map((card, ci) => {
                    const total = Math.min(combo.cards.length, 5);
                    const angle = (ci - (total - 1) / 2) * 5;
                    return (
                      <View
                        key={card.id}
                        style={{
                          marginLeft: ci > 0 ? -16 : 0,
                          transform: [{ rotate: `${angle}deg` }],
                          zIndex: ci,
                        }}
                      >
                        <CardView card={card} />
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          })}

          {topCombo && (
            <View style={[styles.comboChipTable, { zIndex: 10 }]}>
              <CombinationLabel combo={topCombo} />
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function StagingArea({
  cards,
  combo,
  onClear,
}: {
  cards: Card[];
  combo: Combination | null;
  onClear: () => void;
}) {
  if (cards.length === 0) return null;
  return (
    <View style={styles.stagingArea}>
      <View style={styles.stagingCards}>
        {cards.map((card, i) => (
          <View key={card.id} style={{ marginLeft: i > 0 ? -8 : 0, zIndex: i }}>
            <CardView card={card} small />
          </View>
        ))}
      </View>
      <View style={styles.stagingInfo}>
        {combo ? (
          <CombinationLabel combo={combo} />
        ) : (
          <Text style={styles.stagingInvalidText}>Combinazione non valida</Text>
        )}
      </View>
      <Pressable onPress={onClear} style={styles.stagingClear} hitSlop={10}>
        <Ionicons name="close-circle" size={20} color="rgba(240,234,214,0.4)" />
      </Pressable>
    </View>
  );
}

function FanHand({
  cards,
  selectedIds,
  onCardPress,
  disabled,
  W,
}: {
  cards: ReturnType<typeof sortHand>;
  selectedIds: string[];
  onCardPress: (id: string) => void;
  disabled: boolean;
  W: number;
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
  const MAX_SPREAD = W - 60;
  const OVERLAP = Math.max(14, Math.min(36, (total * CARD_W - MAX_SPREAD) / Math.max(total - 1, 1)));
  const effectiveStep = CARD_W - OVERLAP;
  const totalWidth = effectiveStep * (total - 1) + CARD_W;
  const maxAngle = Math.min(28, total * 2.2);

  return (
    <View style={[styles.fanContainer, { height: 100 }]}>
      <View style={[styles.fanRow, { width: Math.min(totalWidth, MAX_SPREAD + CARD_W) }]}>
        {cards.map((card, i) => {
          const center = (total - 1) / 2;
          const angle = ((i - center) / Math.max(center, 1)) * maxAngle;
          const arcRise = Math.abs(i - center) * 2.5;
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
                noLift
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
  const { width: W, height: H } = useWindowDimensions();
  const isLandscape = W > H;

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
  const [playedPile, setPlayedPile] = useState<Combination[]>([]);
  const [timeLeft, setTimeLeft] = useState(HUMAN_TURN_SECONDS);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevComboRef = useRef<Combination | null>(null);

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

  useEffect(() => {
    if (!gameState) return;
    const combo = gameState.lastPlayedCombination;
    if (combo !== null && combo !== prevComboRef.current) {
      setPlayedPile((prev) => [...prev.slice(-5), combo]);
    }
    if (combo === null) {
      setPlayedPile([]);
    }
    prevComboRef.current = combo;
  }, [gameState?.lastPlayedCombination]);

  const humanIdx = gameState ? gameState.players.findIndex((p) => p.type === "human") : -1;
  const isHumanTurn = gameState ? gameState.currentTurnIndex === humanIdx : false;
  const isFinished = gameState ? gameState.players[humanIdx]?.finishPosition !== undefined : false;

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (!isHumanTurn || isFinished || !gameState || gameState.gameOver) {
      setTimeLeft(HUMAN_TURN_SECONDS);
      return;
    }
    setTimeLeft(HUMAN_TURN_SECONDS);
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          const isNewRound = gameState.lastPlayedCombination === null;
          if (!isNewRound) {
            passTurn();
          }
          return HUMAN_TURN_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isHumanTurn, isFinished, gameState?.currentTurnIndex, gameState?.lastPlayedCombination]);

  if (!gameState) {
    router.replace("/");
    return null;
  }

  const humanPlayer = gameState.players[humanIdx];
  const currentPlayer = gameState.players[gameState.currentTurnIndex];
  const isNewRound = gameState.lastPlayedCombination === null;

  const sortedHand = sortHand(humanPlayer?.hand ?? []);
  const selectedObjs = sortedHand.filter((c) => selectedCards.includes(c.id));
  const tentativeCombo = selectedObjs.length > 0 ? buildCombination(selectedObjs) : null;
  const isValidPlay =
    tentativeCombo !== null &&
    canPlay(tentativeCombo, isNewRound ? null : gameState.lastPlayedCombination);
  const canPassNow = !isNewRound && isHumanTurn && !isFinished;
  const playBtnValid = isValidPlay && isHumanTurn && !isFinished;

  const opponents = gameState.players
    .map((p, idx) => ({ p, idx }))
    .filter(({ idx }) => idx !== humanIdx);

  const totalOpponents = opponents.length;

  const handlePlay = () => {
    if (!playBtnValid) return;
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

  const handleClearSelection = () => {
    selectedCards.forEach((id) => selectCard(id));
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const tableW = isLandscape ? Math.min(W * 0.4, 280) : W * 0.76;
  const tableH = isLandscape ? Math.min(H * 0.52, 200) : tableW * 0.7;

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
          <View
            style={[
              styles.turnDot,
              { backgroundColor: isHumanTurn ? Colors.gold : Colors.accent },
            ]}
          />
          <Text style={styles.turnText} numberOfLines={1}>
            {isHumanTurn
              ? isFinished
                ? "Aspetti gli altri..."
                : "Il tuo turno"
              : `${currentPlayer.name} pensa...`}
          </Text>
        </View>

        {isHumanTurn && !isFinished ? (
          <TimerRing seconds={timeLeft} total={HUMAN_TURN_SECONDS} active />
        ) : (
          <View style={styles.cardCountBadge}>
            <Text style={styles.cardCountText}>{humanPlayer?.hand.length ?? 0}</Text>
          </View>
        )}
      </View>

      <View style={[styles.gameArea, isLandscape && styles.gameAreaLandscape]}>
        {isLandscape ? (
          <LandscapeLayout
            opponents={opponents}
            humanIdx={humanIdx}
            totalOpponents={totalOpponents}
            gameState={gameState}
            playedPile={playedPile}
            roundWinnerName={roundWinnerName}
            tableW={tableW}
            tableH={tableH}
            sortedHand={sortedHand}
            selectedCards={selectedCards}
            selectedObjs={selectedObjs}
            tentativeCombo={tentativeCombo}
            isHumanTurn={isHumanTurn}
            isFinished={isFinished}
            playBtnValid={playBtnValid}
            canPassNow={canPassNow}
            bottomPad={bottomPad}
            W={W}
            onCardPress={handleCardPress}
            onPlay={handlePlay}
            onPass={handlePass}
            onClear={handleClearSelection}
          />
        ) : (
          <PortraitLayout
            opponents={opponents}
            humanIdx={humanIdx}
            totalOpponents={totalOpponents}
            gameState={gameState}
            playedPile={playedPile}
            roundWinnerName={roundWinnerName}
            tableW={tableW}
            tableH={tableH}
            sortedHand={sortedHand}
            selectedCards={selectedCards}
            selectedObjs={selectedObjs}
            tentativeCombo={tentativeCombo}
            isHumanTurn={isHumanTurn}
            isFinished={isFinished}
            playBtnValid={playBtnValid}
            canPassNow={canPassNow}
            bottomPad={bottomPad}
            W={W}
            onCardPress={handleCardPress}
            onPlay={handlePlay}
            onPass={handlePass}
            onClear={handleClearSelection}
          />
        )}
      </View>
    </View>
  );
}

type LayoutProps = {
  opponents: { p: Player; idx: number }[];
  humanIdx: number;
  totalOpponents: number;
  gameState: NonNullable<ReturnType<typeof useGame>["gameState"]>;
  playedPile: Combination[];
  roundWinnerName: string | null;
  tableW: number;
  tableH: number;
  sortedHand: ReturnType<typeof sortHand>;
  selectedCards: string[];
  selectedObjs: Card[];
  tentativeCombo: Combination | null;
  isHumanTurn: boolean;
  isFinished: boolean;
  playBtnValid: boolean;
  canPassNow: boolean;
  bottomPad: number;
  W: number;
  onCardPress: (id: string) => void;
  onPlay: () => void;
  onPass: () => void;
  onClear: () => void;
};

function PortraitLayout({
  opponents,
  humanIdx,
  totalOpponents,
  gameState,
  playedPile,
  roundWinnerName,
  tableW,
  tableH,
  sortedHand,
  selectedCards,
  selectedObjs,
  tentativeCombo,
  isHumanTurn,
  isFinished,
  playBtnValid,
  canPassNow,
  bottomPad,
  W,
  onCardPress,
  onPlay,
  onPass,
  onClear,
}: LayoutProps) {
  const topOpp = opponents.find((o, i) => {
    const steps = ((o.idx - humanIdx) % gameState.players.length + gameState.players.length) % gameState.players.length;
    return getOpponentPosition(steps, totalOpponents) === "top";
  });
  const leftOpp = opponents.find((o) => {
    const steps = ((o.idx - humanIdx) % gameState.players.length + gameState.players.length) % gameState.players.length;
    return getOpponentPosition(steps, totalOpponents) === "left";
  });
  const rightOpp = opponents.find((o) => {
    const steps = ((o.idx - humanIdx) % gameState.players.length + gameState.players.length) % gameState.players.length;
    return getOpponentPosition(steps, totalOpponents) === "right";
  });

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.compassTable}>
        {topOpp && (
          <View style={styles.topOppWrapper}>
            <OpponentBadge
              player={topOpp.p}
              isActive={topOpp.idx === gameState.currentTurnIndex}
              position="top"
            />
          </View>
        )}

        <View style={styles.sideRow}>
          {leftOpp ? (
            <View style={styles.leftOppWrapper}>
              <OpponentBadge
                player={leftOpp.p}
                isActive={leftOpp.idx === gameState.currentTurnIndex}
                position="left"
              />
            </View>
          ) : (
            <View style={styles.sideOppPlaceholder} />
          )}

          <PlayedPile
            history={playedPile}
            roundWinnerName={roundWinnerName}
            tableW={tableW}
            tableH={tableH}
          />

          {rightOpp ? (
            <View style={styles.rightOppWrapper}>
              <OpponentBadge
                player={rightOpp.p}
                isActive={rightOpp.idx === gameState.currentTurnIndex}
                position="right"
              />
            </View>
          ) : (
            <View style={styles.sideOppPlaceholder} />
          )}
        </View>
      </View>

      <PlayerBottomArea
        sortedHand={sortedHand}
        selectedCards={selectedCards}
        selectedObjs={selectedObjs}
        tentativeCombo={tentativeCombo}
        isHumanTurn={isHumanTurn}
        isFinished={isFinished}
        playBtnValid={playBtnValid}
        canPassNow={canPassNow}
        bottomPad={bottomPad}
        W={W}
        onCardPress={onCardPress}
        onPlay={onPlay}
        onPass={onPass}
        onClear={onClear}
        humanHandLength={0}
        finishPosition={undefined}
      />
    </View>
  );
}

function LandscapeLayout({
  opponents,
  humanIdx,
  totalOpponents,
  gameState,
  playedPile,
  roundWinnerName,
  tableW,
  tableH,
  sortedHand,
  selectedCards,
  selectedObjs,
  tentativeCombo,
  isHumanTurn,
  isFinished,
  playBtnValid,
  canPassNow,
  bottomPad,
  W,
  onCardPress,
  onPlay,
  onPass,
  onClear,
}: LayoutProps) {
  const leftOpp = opponents.find((o) => {
    const steps = ((o.idx - humanIdx) % gameState.players.length + gameState.players.length) % gameState.players.length;
    const pos = getOpponentPosition(steps, totalOpponents);
    return pos === "left" || (totalOpponents === 1 && pos === "top");
  });
  const rightOpp = opponents.find((o) => {
    const steps = ((o.idx - humanIdx) % gameState.players.length + gameState.players.length) % gameState.players.length;
    return getOpponentPosition(steps, totalOpponents) === "right";
  });
  const topOpp = opponents.find((o) => {
    const steps = ((o.idx - humanIdx) % gameState.players.length + gameState.players.length) % gameState.players.length;
    const pos = getOpponentPosition(steps, totalOpponents);
    return totalOpponents === 3 && pos === "top";
  });

  return (
    <View style={{ flex: 1, flexDirection: "row" }}>
      <View style={styles.landscapeLeft}>
        {leftOpp && (
          <OpponentBadge
            player={leftOpp.p}
            isActive={leftOpp.idx === gameState.currentTurnIndex}
            position="left"
          />
        )}
      </View>

      <View style={styles.landscapeCenter}>
        {topOpp && (
          <View style={{ marginBottom: 6 }}>
            <OpponentBadge
              player={topOpp.p}
              isActive={topOpp.idx === gameState.currentTurnIndex}
              position="top"
            />
          </View>
        )}
        <PlayedPile
          history={playedPile}
          roundWinnerName={roundWinnerName}
          tableW={tableW}
          tableH={tableH}
        />
        <PlayerBottomArea
          sortedHand={sortedHand}
          selectedCards={selectedCards}
          selectedObjs={selectedObjs}
          tentativeCombo={tentativeCombo}
          isHumanTurn={isHumanTurn}
          isFinished={isFinished}
          playBtnValid={playBtnValid}
          canPassNow={canPassNow}
          bottomPad={bottomPad}
          W={W * 0.6}
          onCardPress={onCardPress}
          onPlay={onPlay}
          onPass={onPass}
          onClear={onClear}
          humanHandLength={0}
          finishPosition={undefined}
          compact
        />
      </View>

      <View style={styles.landscapeRight}>
        {rightOpp && (
          <OpponentBadge
            player={rightOpp.p}
            isActive={rightOpp.idx === gameState.currentTurnIndex}
            position="right"
          />
        )}
      </View>
    </View>
  );
}

function PlayerBottomArea({
  sortedHand,
  selectedCards,
  selectedObjs,
  tentativeCombo,
  isHumanTurn,
  isFinished,
  playBtnValid,
  canPassNow,
  bottomPad,
  W,
  onCardPress,
  onPlay,
  onPass,
  onClear,
  compact,
}: LayoutProps & { humanHandLength: number; finishPosition: number | undefined; compact?: boolean }) {
  return (
    <View style={[styles.playerArea, { paddingBottom: bottomPad + 8 }]}>
      {selectedObjs.length > 0 && (
        <StagingArea cards={selectedObjs} combo={tentativeCombo} onClear={onClear} />
      )}

      <View style={[styles.actionRow, compact && { paddingHorizontal: 8 }]}>
        <Pressable
          onPress={onPass}
          disabled={!canPassNow}
          style={[styles.passBtn, !canPassNow && styles.btnDisabled]}
        >
          <Ionicons
            name="arrow-undo"
            size={16}
            color={canPassNow ? Colors.textSecondary : Colors.textMuted}
          />
          <Text style={[styles.passBtnText, !canPassNow && { color: Colors.textMuted }]}>
            Passa
          </Text>
        </Pressable>

        <Pressable
          onPress={onPlay}
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
                {`Gioca${selectedCards.length > 1 ? ` (${selectedCards.length})` : ""}`}
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
                  : "Carta troppo bassa"}
              </Text>
            </View>
          )}
        </Pressable>
      </View>

      {isFinished ? (
        <View style={styles.finishedBanner}>
          <Ionicons name="trophy" size={18} color={Colors.gold} />
          <Text style={styles.finishedText}>Hai finito! Aspetti gli altri...</Text>
        </View>
      ) : (
        <FanHand
          cards={sortedHand}
          selectedIds={selectedCards}
          onCardPress={onCardPress}
          disabled={!isHumanTurn}
          W={W}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#072A18" },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
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
    paddingVertical: 7,
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

  gameArea: { flex: 1 },
  gameAreaLandscape: { flexDirection: "row" },

  compassTable: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  topOppWrapper: {
    marginBottom: 8,
    alignItems: "center",
  },
  sideRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    flex: 1,
  },
  leftOppWrapper: {
    alignItems: "flex-end",
  },
  rightOppWrapper: {
    alignItems: "flex-start",
  },
  sideOppPlaceholder: {
    width: 90,
  },

  landscapeLeft: {
    width: 110,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 4,
  },
  landscapeCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  landscapeRight: {
    width: 110,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 4,
  },

  opponentBadge: {
    backgroundColor: "rgba(0,0,0,0.3)",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
    maxWidth: 110,
  },
  opponentBadgeActive: {
    borderColor: Colors.gold,
    backgroundColor: "rgba(201,168,76,0.12)",
  },
  opponentBadgeVertical: {
    maxWidth: 105,
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
    maxWidth: 60,
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
    height: 52,
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  miniHandVertical: {
    flexDirection: "column",
    height: "auto" as any,
    width: 42,
  },
  miniCardHorizontal: {},
  miniCardVertical: {},

  tableEllipse: {
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(201,168,76,0.22)",
  },
  tableEllipseBorder: {
    position: "absolute",
    top: 6,
    left: 6,
    right: 6,
    bottom: 6,
    borderWidth: 1,
    borderColor: "rgba(201,168,76,0.1)",
  },
  roundWinnerBanner: {
    position: "absolute",
    top: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: Colors.goldMuted,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.goldDark,
    zIndex: 20,
  },
  roundWinnerText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 11,
    color: Colors.gold,
  },
  emptyTableText: {
    fontFamily: "Rajdhani_500Medium",
    fontSize: 14,
    color: "rgba(240,234,214,0.2)",
  },
  pileContainer: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  pileLayer: {
    position: "absolute",
  },
  playedCardsRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
  },
  comboChipTable: {
    position: "absolute",
    bottom: -36,
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

  stagingArea: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(201,168,76,0.08)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(201,168,76,0.2)",
    gap: 10,
    minHeight: 52,
  },
  stagingCards: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  stagingInfo: {
    alignItems: "flex-end",
  },
  stagingInvalidText: {
    fontFamily: "Rajdhani_500Medium",
    fontSize: 11,
    color: "rgba(255,100,100,0.8)",
  },
  stagingClear: {
    padding: 4,
  },

  playerArea: {
    backgroundColor: "rgba(0,0,0,0.3)",
    borderTopWidth: 1,
    borderTopColor: "rgba(201,168,76,0.15)",
    paddingTop: 10,
    gap: 10,
  },

  fanContainer: {
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
    paddingVertical: 10,
    marginHorizontal: 14,
    backgroundColor: Colors.goldMuted,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.goldDark,
  },
  finishedText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 13,
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
    paddingVertical: 13,
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
    paddingVertical: 13,
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
