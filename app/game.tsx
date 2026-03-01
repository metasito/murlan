import React, { useEffect, useRef, useState } from "react";
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
import * as ScreenOrientation from "expo-screen-orientation";
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
const PASS_BTN_W = 82;
const PLAY_BTN_W = 82;
const CARD_W = 58;
const CARD_H = 84;

function getOpponentPosition(
  clockwiseSteps: number,
  totalOpponents: number
): "top" | "left" | "right" {
  if (totalOpponents === 1) return "top";
  if (totalOpponents === 2) return clockwiseSteps === 1 ? "right" : "left";
  if (clockwiseSteps === 1) return "right";
  if (clockwiseSteps === 2) return "top";
  return "left";
}

function ComboLabel({ combo }: { combo: Combination }) {
  const map: Record<string, string> = {
    single: "Singola",
    pair: "Coppia",
    triple: "Tris",
    straight: "Scala",
  };
  return (
    <View style={styles.comboChip}>
      <Text style={styles.comboChipText}>
        {map[combo.type]}{combo.cards.length > 2 ? ` ×${combo.cards.length}` : ""}
      </Text>
    </View>
  );
}

function Avatar({
  name,
  isActive,
  cardCount,
  finishPos,
  size = 54,
}: {
  name: string;
  isActive: boolean;
  cardCount: number;
  finishPos?: number;
  size?: number;
}) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (isActive) {
      pulse.value = withSequence(
        withTiming(1.08, { duration: 400 }),
        withTiming(1, { duration: 400 })
      );
    }
  }, [isActive]);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <Animated.View style={aStyle}>
      <View
        style={[
          styles.avatarRing,
          { width: size + 6, height: size + 6, borderRadius: (size + 6) / 2 },
          isActive && styles.avatarRingActive,
        ]}
      >
        <View
          style={[
            styles.avatarCircle,
            { width: size, height: size, borderRadius: size / 2 },
          ]}
        >
          <Text style={[styles.avatarInitials, { fontSize: size * 0.36 }]}>
            {initials}
          </Text>
        </View>
        {finishPos !== undefined && (
          <View style={styles.finishBadge}>
            <Ionicons name="trophy" size={9} color={Colors.gold} />
            <Text style={styles.finishBadgeText}>#{finishPos}</Text>
          </View>
        )}
        {finishPos === undefined && (
          <View style={styles.cardCountBubble}>
            <Text style={styles.cardCountBubbleText}>{cardCount}</Text>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

function MiniCardFan({
  count,
  direction,
}: {
  count: number;
  direction: "left" | "right" | "down";
}) {
  const n = Math.min(count, 6);
  if (n === 0) return null;

  return (
    <View style={[styles.miniFan, direction === "down" && styles.miniFanDown]}>
      {Array.from({ length: n }, (_, i) => {
        const spread = (i - (n - 1) / 2) * (direction === "down" ? 5 : 4);
        const translateX = direction === "down" ? 0 : (direction === "right" ? -i * 8 : i * 8);
        const translateY = direction === "down" ? -i * 6 : 0;
        return (
          <View
            key={i}
            style={[
              styles.miniFanCard,
              {
                marginLeft: direction !== "down" && i > 0 ? -22 : 0,
                marginTop: direction === "down" && i > 0 ? -28 : 0,
                transform: [
                  { rotate: `${spread}deg` },
                ],
                zIndex: i,
              },
            ]}
          >
            <CardView
              card={{ id: `bk_${i}`, suit: null, rank: "3", isJoker: false }}
              faceDown
              small
            />
          </View>
        );
      })}
    </View>
  );
}

function TopOpponent({
  player,
  isActive,
  tableW,
  tableX,
}: {
  player: Player;
  isActive: boolean;
  tableW: number;
  tableX: number;
}) {
  const cardCount = player.hand.length;
  return (
    <View style={[styles.topOppContainer, { left: tableX + tableW / 2 - 55 }]}>
      <View style={styles.topOppInner}>
        <Avatar
          name={player.name}
          isActive={isActive}
          cardCount={cardCount}
          finishPos={player.finishPosition}
          size={48}
        />
        <Text style={styles.oppName} numberOfLines={1}>{player.name}</Text>
      </View>
      {cardCount > 0 && (
        <MiniCardFan count={cardCount} direction="down" />
      )}
    </View>
  );
}

function SideOpponent({
  player,
  isActive,
  position,
  y,
}: {
  player: Player;
  isActive: boolean;
  position: "left" | "right";
  y: number;
}) {
  const cardCount = player.hand.length;
  const isLeft = position === "left";
  return (
    <View
      style={[
        styles.sideOppContainer,
        isLeft ? styles.sideOppLeft : styles.sideOppRight,
        { top: y },
      ]}
    >
      {!isLeft && cardCount > 0 && (
        <MiniCardFan count={cardCount} direction="right" />
      )}
      <View style={styles.sideOppInner}>
        <Avatar
          name={player.name}
          isActive={isActive}
          cardCount={cardCount}
          finishPos={player.finishPosition}
          size={46}
        />
        <Text style={styles.oppName} numberOfLines={1}>{player.name}</Text>
      </View>
      {isLeft && cardCount > 0 && (
        <MiniCardFan count={cardCount} direction="left" />
      )}
    </View>
  );
}

function PlayedPile({
  history,
  roundWinner,
}: {
  history: Combination[];
  roundWinner: string | null;
}) {
  const topCombo = history.length > 0 ? history[history.length - 1] : null;

  return (
    <View style={styles.playedPileArea}>
      {roundWinner && (
        <Animated.View entering={FadeIn.duration(250)} exiting={FadeOut.duration(250)} style={styles.winnerBanner}>
          <Ionicons name="star" size={10} color={Colors.gold} />
          <Text style={styles.winnerText}>{roundWinner}</Text>
        </Animated.View>
      )}

      {history.length === 0 && (
        <Text style={styles.emptyTableText}>Inizia il round</Text>
      )}

      {history.length > 0 && (
        <View style={styles.pileStack}>
          {history.slice(-4).map((combo, si, arr) => {
            const isTop = si === arr.length - 1;
            const rot = (si * 9 - 12) % 18;
            const offsetY = (si - arr.length + 1) * 3;
            return (
              <View
                key={`pl_${si}`}
                style={[
                  styles.pileLayer,
                  {
                    zIndex: si,
                    transform: [{ rotate: `${rot}deg` }, { translateY: offsetY }],
                    opacity: isTop ? 1 : 0.45 + si * 0.15,
                  },
                ]}
              >
                <View style={styles.playedCardRow}>
                  {combo.cards.slice(0, 5).map((card, ci) => (
                    <View
                      key={card.id}
                      style={{ marginLeft: ci > 0 ? -14 : 0, zIndex: ci }}
                    >
                      <CardView card={card} />
                    </View>
                  ))}
                </View>
              </View>
            );
          })}
          {topCombo && (
            <View style={styles.topComboLabel}>
              <ComboLabel combo={topCombo} />
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function StraightHand({
  cards,
  selectedIds,
  onPress,
  disabled,
  availW,
}: {
  cards: ReturnType<typeof sortHand>;
  selectedIds: string[];
  onPress: (id: string) => void;
  disabled: boolean;
  availW: number;
}) {
  const n = cards.length;
  if (n === 0) {
    return (
      <View style={[styles.handWrap, { width: availW }]}>
        <Ionicons name="checkmark-circle" size={26} color={Colors.gold} />
        <Text style={styles.emptyHandText}>Carte finite!</Text>
      </View>
    );
  }

  const step = Math.max(22, Math.min(CARD_W, (availW - CARD_W) / Math.max(n - 1, 1)));
  const totalW = step * (n - 1) + CARD_W;

  return (
    <View style={[styles.handWrap, { width: availW }]}>
      <View style={[styles.handRow, { width: Math.min(totalW, availW) }]}>
        {cards.map((card, i) => {
          const isSelected = selectedIds.includes(card.id);
          return (
            <CardItem
              key={card.id}
              card={card}
              isSelected={isSelected}
              left={i * step}
              onPress={() => onPress(card.id)}
              disabled={disabled}
              zIndex={isSelected ? n + 10 : i}
            />
          );
        })}
      </View>
    </View>
  );
}

function CardItem({
  card,
  isSelected,
  left,
  onPress,
  disabled,
  zIndex,
}: {
  card: Card;
  isSelected: boolean;
  left: number;
  onPress: () => void;
  disabled: boolean;
  zIndex: number;
}) {
  const liftY = useSharedValue(0);
  useEffect(() => {
    liftY.value = withSpring(isSelected ? -38 : 0, { damping: 14, stiffness: 260 });
  }, [isSelected]);
  const aStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: liftY.value }],
  }));

  return (
    <Animated.View style={[styles.handCardWrap, { left, zIndex }, aStyle]}>
      <CardView card={card} selected={isSelected} onPress={onPress} disabled={disabled} noLift />
    </Animated.View>
  );
}

export default function GameScreen() {
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();

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

  const [roundWinner, setRoundWinner] = useState<string | null>(null);
  const [playedPile, setPlayedPile] = useState<Combination[]>([]);
  const [timeLeft, setTimeLeft] = useState(HUMAN_TURN_SECONDS);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevComboRef = useRef<Combination | null>(null);

  useEffect(() => {
    if (Platform.OS !== "web") {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    }
    return () => {
      if (Platform.OS !== "web") {
        ScreenOrientation.unlockAsync();
      }
    };
  }, []);

  useEffect(() => {
    if (!gameState) return;
    if (gameState.gameOver) {
      setTimeout(() => router.replace("/result"), 800);
      return;
    }
    const cur = gameState.players[gameState.currentTurnIndex];
    if (cur.type === "ai") {
      const t = setTimeout(() => runAITurnRef.current(), AI_DELAY);
      return () => clearTimeout(t);
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
      setRoundWinner(name);
      const t = setTimeout(() => setRoundWinner(null), 1800);
      return () => clearTimeout(t);
    }
  }, [lastRoundWinner]);

  useEffect(() => {
    if (!gameState) return;
    const combo = gameState.lastPlayedCombination;
    if (combo !== null && combo !== prevComboRef.current) {
      setPlayedPile((prev) => [...prev.slice(-5), combo]);
    }
    if (combo === null) setPlayedPile([]);
    prevComboRef.current = combo;
  }, [gameState?.lastPlayedCombination]);

  const humanIdx = gameState ? gameState.players.findIndex((p) => p.type === "human") : -1;
  const isHumanTurn = gameState ? gameState.currentTurnIndex === humanIdx : false;
  const isFinished = gameState ? gameState.players[humanIdx]?.finishPosition !== undefined : false;

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!isHumanTurn || isFinished || !gameState || gameState.gameOver) {
      setTimeLeft(HUMAN_TURN_SECONDS);
      return;
    }
    setTimeLeft(HUMAN_TURN_SECONDS);
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          if (gameState.lastPlayedCombination !== null) passTurn();
          return HUMAN_TURN_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
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
  const isValidPlay = tentativeCombo !== null && canPlay(tentativeCombo, isNewRound ? null : gameState.lastPlayedCombination);
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
      { text: "Esci", style: "destructive", onPress: () => { resetGame(); router.replace("/"); } },
    ]);
  };

  const handleCardPress = (id: string) => {
    if (!isHumanTurn || isFinished) return;
    Haptics.selectionAsync();
    selectCard(id);
  };

  const handleClear = () => selectedCards.forEach((id) => selectCard(id));

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const leftPad = Platform.OS === "web" ? 0 : insets.left;
  const rightPad = Platform.OS === "web" ? 0 : insets.right;

  const TOP_BAR_H = 44;
  const BOTTOM_AREA_H = CARD_H + 20 + bottomPad;
  const gameAreaH = H - topPad - TOP_BAR_H - BOTTOM_AREA_H;

  const TOP_OPP_SPACE = 68;
  const tableX = leftPad + 8;
  const tableW = W - leftPad - rightPad - 16;
  const tableTop = TOP_OPP_SPACE;
  const tableH = Math.max(100, gameAreaH - TOP_OPP_SPACE - 4);

  const sideOppY = tableTop + tableH * 0.5 - 55;

  const handAvailW = W - leftPad - rightPad - PASS_BTN_W - PLAY_BTN_W - 24;

  const topOpp = opponents.find((o) => {
    const steps = ((o.idx - humanIdx + gameState.players.length) % gameState.players.length);
    return getOpponentPosition(steps, totalOpponents) === "top";
  });
  const leftOpp = opponents.find((o) => {
    const steps = ((o.idx - humanIdx + gameState.players.length) % gameState.players.length);
    return getOpponentPosition(steps, totalOpponents) === "left";
  });
  const rightOpp = opponents.find((o) => {
    const steps = ((o.idx - humanIdx + gameState.players.length) % gameState.players.length);
    return getOpponentPosition(steps, totalOpponents) === "right";
  });

  const urgent = timeLeft <= 5 && isHumanTurn && !isFinished;

  return (
    <View style={[styles.root, { paddingTop: topPad, paddingLeft: leftPad, paddingRight: rightPad }]}>
      <LinearGradient colors={["#041A0E", "#072A18", "#041A0E"]} style={StyleSheet.absoluteFill} />

      <View style={[styles.topBar, { height: TOP_BAR_H }]}>
        <Pressable onPress={handleQuit} style={styles.quitBtn} hitSlop={10}>
          <Ionicons name="close" size={17} color="rgba(240,234,214,0.45)" />
        </Pressable>

        <View style={styles.turnPill}>
          <View style={[styles.turnDot, { backgroundColor: isHumanTurn ? Colors.gold : Colors.accent }]} />
          <Text style={styles.turnText} numberOfLines={1}>
            {isHumanTurn
              ? isFinished ? "Aspetti gli altri..." : "Il tuo turno"
              : `${currentPlayer.name} pensa...`}
          </Text>
          {isHumanTurn && !isFinished && (
            <Text style={[styles.timerNum, urgent && styles.timerUrgent]}>{timeLeft}</Text>
          )}
        </View>

        <View style={styles.cardCountPill}>
          <Text style={styles.cardCountNum}>{humanPlayer?.hand.length ?? 0}</Text>
        </View>
      </View>

      <View style={[styles.gameArea, { height: gameAreaH }]}>
        <View
          style={[
            styles.table,
            {
              left: tableX,
              top: tableTop,
              width: tableW,
              height: tableH,
            },
          ]}
        >
          <LinearGradient
            colors={[Colors.feltLight, Colors.felt, Colors.feltDark]}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.tableBorder, { borderRadius: 20 }]} />

          <PlayedPile history={playedPile} roundWinner={roundWinner} />
        </View>

        {topOpp && (
          <TopOpponent
            player={topOpp.p}
            isActive={topOpp.idx === gameState.currentTurnIndex}
            tableW={tableW}
            tableX={tableX}
          />
        )}

        {leftOpp && (
          <SideOpponent
            player={leftOpp.p}
            isActive={leftOpp.idx === gameState.currentTurnIndex}
            position="left"
            y={sideOppY}
          />
        )}

        {rightOpp && (
          <SideOpponent
            player={rightOpp.p}
            isActive={rightOpp.idx === gameState.currentTurnIndex}
            position="right"
            y={sideOppY}
          />
        )}
      </View>

      <View style={[styles.bottomArea, { height: BOTTOM_AREA_H, paddingBottom: bottomPad }]}>
        <Pressable
          onPress={handlePass}
          disabled={!canPassNow}
          style={[styles.passBtn, !canPassNow && styles.passBtnDisabled]}
        >
          <Text style={[styles.passBtnText, !canPassNow && styles.passBtnTextDim]}>PASSA</Text>
        </Pressable>

        {isFinished ? (
          <View style={[styles.handWrap, { width: handAvailW, justifyContent: "center", flexDirection: "row", gap: 8 }]}>
            <Ionicons name="trophy" size={20} color={Colors.gold} />
            <Text style={styles.finishedTxt}>Hai finito! Aspetti gli altri...</Text>
          </View>
        ) : (
          <StraightHand
            cards={sortedHand}
            selectedIds={selectedCards}
            onPress={handleCardPress}
            disabled={!isHumanTurn}
            availW={handAvailW}
          />
        )}

        <Pressable
          onPress={playBtnValid ? handlePlay : undefined}
          style={[styles.playBtn, !playBtnValid && styles.playBtnDim]}
        >
          {playBtnValid ? (
            <LinearGradient
              colors={[Colors.goldLight, Colors.gold, Colors.goldDark]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.playBtnGrad}
            >
              <Text style={styles.playBtnText}>GIOCA</Text>
              {selectedCards.length > 1 && (
                <Text style={styles.playBtnCount}>{selectedCards.length}</Text>
              )}
            </LinearGradient>
          ) : (
            <View style={styles.playBtnGrad}>
              <Text style={styles.playBtnTextDim}>
                {!isHumanTurn || isFinished
                  ? "—"
                  : selectedCards.length === 0
                  ? "GIOCA"
                  : tentativeCombo === null
                  ? "INVALIDA"
                  : "TROPPO\nBASSA"}
              </Text>
            </View>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#041A0E",
    overflow: "hidden",
  },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    gap: 8,
  },
  quitBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  turnPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.25)",
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
    gap: 6,
  },
  turnDot: { width: 6, height: 6, borderRadius: 3 },
  turnText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 13,
    color: Colors.text,
    flex: 1,
  },
  timerNum: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 14,
    color: Colors.gold,
    minWidth: 20,
    textAlign: "right",
  },
  timerUrgent: { color: "#FF5252" },
  cardCountPill: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  cardCountNum: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 15,
    color: Colors.gold,
  },

  gameArea: {
    position: "relative",
    overflow: "visible",
  },

  table: {
    position: "absolute",
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 3,
    borderColor: "rgba(201,168,76,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  tableBorder: {
    position: "absolute",
    top: 6,
    left: 6,
    right: 6,
    bottom: 6,
    borderWidth: 1.5,
    borderColor: "rgba(201,168,76,0.12)",
  },

  topOppContainer: {
    position: "absolute",
    top: 0,
    alignItems: "center",
    width: 110,
  },
  topOppInner: {
    alignItems: "center",
    gap: 3,
  },

  sideOppContainer: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  sideOppLeft: { left: 2 },
  sideOppRight: { right: 2, flexDirection: "row-reverse" },
  sideOppInner: {
    alignItems: "center",
    gap: 3,
  },

  oppName: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 10,
    color: "rgba(240,234,214,0.7)",
    maxWidth: 70,
    textAlign: "center",
  },

  avatarRing: {
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  avatarRingActive: {
    borderColor: Colors.gold,
    shadowColor: Colors.gold,
    shadowOpacity: 0.6,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  avatarCircle: {
    backgroundColor: "rgba(11,59,37,0.9)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(201,168,76,0.2)",
  },
  avatarInitials: {
    fontFamily: "Rajdhani_700Bold",
    color: Colors.text,
    letterSpacing: 1,
  },
  finishBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.goldMuted,
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 2,
    gap: 2,
  },
  finishBadgeText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 8,
    color: Colors.gold,
  },
  cardCountBubble: {
    position: "absolute",
    bottom: -2,
    right: -2,
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  cardCountBubbleText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 9,
    color: Colors.gold,
  },

  miniFan: {
    flexDirection: "row",
    alignItems: "flex-end",
  },
  miniFanDown: {
    flexDirection: "column",
    alignItems: "center",
  },
  miniFanCard: {},

  playedPileArea: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 80,
  },
  winnerBanner: {
    position: "absolute",
    top: -24,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.goldMuted,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.goldDark,
  },
  winnerText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 11,
    color: Colors.gold,
  },
  emptyTableText: {
    fontFamily: "Rajdhani_500Medium",
    fontSize: 13,
    color: "rgba(240,234,214,0.18)",
  },
  pileStack: {
    alignItems: "center",
    justifyContent: "center",
  },
  pileLayer: { position: "absolute" },
  playedCardRow: {
    flexDirection: "row",
    alignItems: "flex-end",
  },
  topComboLabel: {
    marginTop: CARD_H + 8,
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
    fontSize: 10,
    color: Colors.gold,
    letterSpacing: 1,
    textTransform: "uppercase",
  },

  bottomArea: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 6,
    gap: 6,
  },

  passBtn: {
    width: PASS_BTN_W,
    height: CARD_H,
    borderRadius: CARD_H / 2,
    backgroundColor: "#5C1A1A",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#8B2222",
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  passBtnDisabled: {
    backgroundColor: "rgba(50,20,20,0.5)",
    borderColor: "rgba(139,34,34,0.3)",
  },
  passBtnText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 14,
    color: "#FF8A8A",
    letterSpacing: 1,
  },
  passBtnTextDim: {
    color: "rgba(255,138,138,0.35)",
  },

  playBtn: {
    width: PLAY_BTN_W,
    height: CARD_H,
    borderRadius: CARD_H / 2,
    overflow: "hidden",
    shadowColor: Colors.gold,
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  playBtnDim: {
    shadowOpacity: 0,
  },
  playBtnGrad: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(50,40,10,0.5)",
    borderWidth: 2,
    borderColor: "rgba(201,168,76,0.25)",
    borderRadius: CARD_H / 2,
    gap: 2,
  },
  playBtnText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 14,
    color: "#0A1F18",
    letterSpacing: 1,
  },
  playBtnTextDim: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 10,
    color: "rgba(201,168,76,0.35)",
    letterSpacing: 0.5,
    textAlign: "center",
  },
  playBtnCount: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 11,
    color: "#0A1F18",
  },

  handWrap: {
    alignItems: "center",
    justifyContent: "center",
    height: CARD_H,
    flexDirection: "row",
    gap: 6,
  },
  handRow: {
    position: "relative",
    height: CARD_H,
    alignSelf: "center",
  },
  handCardWrap: {
    position: "absolute",
    bottom: 0,
  },

  emptyHandText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 13,
    color: Colors.gold,
  },
  finishedTxt: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 12,
    color: Colors.gold,
  },
});
