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
const CARD_W = 58;
const CARD_H = 84;
const BTN_W = 84;
const BTN_H = 84;
const TOP_BAR_H = 44;
const TABLE_M = 8;
const SIDE_SECTION_W = 160;
const TOP_SECTION_H = 82;
const HAND_SECTION_H = CARD_H + 14;

function getOpponentPosition(
  steps: number,
  total: number
): "top" | "left" | "right" {
  if (total === 1) return "top";
  if (total === 2) return steps === 1 ? "right" : "top";
  if (steps === 1) return "right";
  if (steps === 2) return "top";
  return "left";
}

function CardFan({ count, maxCards = 7 }: { count: number; maxCards?: number }) {
  const n = Math.min(count, maxCards);
  if (n === 0) return null;
  const step = 15;
  const maxAngle = 22;
  const totalW = step * (n - 1) + 40;

  return (
    <View style={{ width: totalW, height: 66 }}>
      {Array.from({ length: n }, (_, i) => {
        const c = (n - 1) / 2;
        const angle = ((i - c) / Math.max(c, 1)) * maxAngle;
        const rise = Math.abs(i - c) * 4;
        return (
          <View
            key={i}
            style={{
              position: "absolute",
              left: i * step,
              bottom: rise,
              transform: [{ rotate: `${angle}deg` }],
              zIndex: i,
            }}
          >
            <CardView
              card={{ id: `bk${i}`, suit: null, rank: "3", isJoker: false }}
              faceDown
              small
            />
          </View>
        );
      })}
    </View>
  );
}

function AvatarCircle({
  name,
  isActive,
  cardCount,
  finishPos,
  size = 44,
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
        withTiming(1.1, { duration: 350 }),
        withTiming(1, { duration: 350 })
      );
    }
  }, [isActive]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <Animated.View style={anim}>
      <View
        style={[
          styles.avatarOuter,
          { width: size + 6, height: size + 6, borderRadius: (size + 6) / 2 },
          isActive && styles.avatarOuterActive,
        ]}
      >
        <View
          style={[
            styles.avatarInner,
            { width: size, height: size, borderRadius: size / 2 },
          ]}
        >
          <Text style={[styles.avatarInitials, { fontSize: size * 0.36 }]}>
            {initials}
          </Text>
        </View>
        <View style={styles.countBubble}>
          {finishPos !== undefined ? (
            <Ionicons name="trophy" size={8} color={Colors.gold} />
          ) : (
            <Text style={styles.countBubbleText}>{cardCount}</Text>
          )}
        </View>
      </View>
    </Animated.View>
  );
}

function TopOppSlot({ player, isActive }: { player: Player; isActive: boolean }) {
  return (
    <View style={styles.topOppSlot}>
      <View style={styles.topOppRow}>
        <View style={styles.topOppAvatarCol}>
          <AvatarCircle
            name={player.name}
            isActive={isActive}
            cardCount={player.hand.length}
            finishPos={player.finishPosition}
            size={42}
          />
          <Text style={styles.oppName} numberOfLines={1}>{player.name}</Text>
        </View>
        {player.finishPosition === undefined && player.hand.length > 0 && (
          <CardFan count={player.hand.length} maxCards={7} />
        )}
      </View>
    </View>
  );
}

function SideOppSlot({
  player,
  isActive,
  side,
}: {
  player: Player;
  isActive: boolean;
  side: "left" | "right";
}) {
  const isLeft = side === "left";
  return (
    <View style={[styles.sideOppSlot, isLeft ? styles.sideLeft : styles.sideRight]}>
      {!isLeft && player.hand.length > 0 && player.finishPosition === undefined && (
        <CardFan count={player.hand.length} maxCards={5} />
      )}
      <View style={styles.sideOppAvatarCol}>
        <AvatarCircle
          name={player.name}
          isActive={isActive}
          cardCount={player.hand.length}
          finishPos={player.finishPosition}
          size={40}
        />
        <Text style={styles.oppName} numberOfLines={1}>{player.name}</Text>
      </View>
      {isLeft && player.hand.length > 0 && player.finishPosition === undefined && (
        <CardFan count={player.hand.length} maxCards={5} />
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
    <View style={styles.pileArea}>
      {roundWinner && (
        <Animated.View
          entering={FadeIn.duration(250)}
          exiting={FadeOut.duration(250)}
          style={styles.winnerTag}
        >
          <Ionicons name="star" size={9} color={Colors.gold} />
          <Text style={styles.winnerText}>{roundWinner}</Text>
        </Animated.View>
      )}

      {history.length === 0 && (
        <Text style={styles.emptyText}>Inizia il round</Text>
      )}

      {history.length > 0 && (
        <View style={styles.pileStack}>
          {history.slice(-4).map((combo, si, arr) => {
            const isTop = si === arr.length - 1;
            const angle = (si - (arr.length - 1)) * 8;
            const dx = (si - (arr.length - 1)) * 5;
            const dy = (si - (arr.length - 1)) * 3;
            return (
              <View
                key={`p${si}`}
                style={[
                  styles.pileLayer,
                  {
                    zIndex: si,
                    opacity: isTop ? 1 : 0.4 + si * 0.15,
                    transform: [
                      { rotate: `${angle}deg` },
                      { translateX: dx },
                      { translateY: dy },
                    ],
                  },
                ]}
              >
                <View style={styles.pileCards}>
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
            <View style={styles.comboLabel}>
              <View style={styles.comboChip}>
                <Text style={styles.comboChipText}>
                  {({ single: "Singola", pair: "Coppia", triple: "Tris", straight: "Scala" } as Record<string, string>)[topCombo.type]}
                  {topCombo.cards.length > 2 ? ` ×${topCombo.cards.length}` : ""}
                </Text>
              </View>
            </View>
          )}
        </View>
      )}
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
    liftY.value = withSpring(isSelected ? -40 : 0, { damping: 14, stiffness: 260 });
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
      <View style={[styles.handCenter, { width: availW }]}>
        <Ionicons name="checkmark-circle" size={24} color={Colors.gold} />
        <Text style={styles.emptyHandText}>Carte finite!</Text>
      </View>
    );
  }
  const step = Math.max(20, Math.min(CARD_W, (availW - CARD_W) / Math.max(n - 1, 1)));
  const totalW = step * (n - 1) + CARD_W;

  return (
    <View style={[styles.handCenter, { width: availW }]}>
      <View style={[styles.handRow, { width: Math.min(totalW, availW) }]}>
        {cards.map((card, i) => (
          <CardItem
            key={card.id}
            card={card}
            isSelected={selectedIds.includes(card.id)}
            left={i * step}
            onPress={() => onPress(card.id)}
            disabled={disabled}
            zIndex={i}
          />
        ))}
      </View>
    </View>
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
      if (Platform.OS !== "web") ScreenOrientation.unlockAsync();
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
  const isFinished = gameState
    ? gameState.players[humanIdx]?.finishPosition !== undefined
    : false;

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
        onPress: () => { resetGame(); router.replace("/"); },
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
  const leftPad = Platform.OS === "web" ? 0 : insets.left;
  const rightPad = Platform.OS === "web" ? 0 : insets.right;
  const urgent = timeLeft <= 5 && isHumanTurn && !isFinished;

  const tableLeft = leftPad + TABLE_M;
  const tableTop = topPad + TOP_BAR_H + TABLE_M;
  const tableRight = rightPad + TABLE_M;
  const tableBottom = bottomPad + TABLE_M;
  const tableW = W - tableLeft - (rightPad + TABLE_M);
  const tableH = H - tableTop - (bottomPad + TABLE_M);

  const topOpp = opponents.find(({ idx }) => {
    const steps = ((idx - humanIdx + gameState.players.length) % gameState.players.length);
    return getOpponentPosition(steps, totalOpponents) === "top";
  });
  const leftOpp = opponents.find(({ idx }) => {
    const steps = ((idx - humanIdx + gameState.players.length) % gameState.players.length);
    return getOpponentPosition(steps, totalOpponents) === "left";
  });
  const rightOpp = opponents.find(({ idx }) => {
    const steps = ((idx - humanIdx + gameState.players.length) % gameState.players.length);
    return getOpponentPosition(steps, totalOpponents) === "right";
  });

  const handAvailW = tableW - (BTN_W + 10) * 2;

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={["#031008", "#072A18", "#031008"]}
        style={StyleSheet.absoluteFill}
      />

      <View
        style={[styles.topBar, { top: topPad, left: leftPad, right: rightPad }]}
      >
        <Pressable onPress={handleQuit} style={styles.quitBtn} hitSlop={10}>
          <Ionicons name="close" size={17} color="rgba(240,234,214,0.5)" />
        </Pressable>
        <View style={styles.turnPill}>
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
          {isHumanTurn && !isFinished && (
            <Text style={[styles.timerNum, urgent && styles.timerUrgent]}>
              {timeLeft}
            </Text>
          )}
        </View>
        <View style={styles.cardCountBadge}>
          <Text style={styles.cardCountText}>{humanPlayer?.hand.length ?? 0}</Text>
        </View>
      </View>

      <View
        style={[
          styles.table,
          {
            left: tableLeft,
            top: tableTop,
            right: tableRight,
            bottom: tableBottom,
          },
        ]}
      >
        <LinearGradient
          colors={["#0D4A2E", Colors.felt, "#082B1A"]}
          locations={[0, 0.5, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.tableInnerBorder} />

        <View style={styles.tableContent}>
          <View style={[styles.topSection, { height: TOP_SECTION_H }]}>
            {topOpp ? (
              <TopOppSlot
                player={topOpp.p}
                isActive={topOpp.idx === gameState.currentTurnIndex}
              />
            ) : (
              <View />
            )}
          </View>

          <View style={styles.midSection}>
            <View style={styles.sideSection}>
              {leftOpp && (
                <SideOppSlot
                  player={leftOpp.p}
                  isActive={leftOpp.idx === gameState.currentTurnIndex}
                  side="left"
                />
              )}
            </View>

            <View style={styles.centerSection}>
              <PlayedPile history={playedPile} roundWinner={roundWinner} />
            </View>

            <View style={styles.sideSection}>
              {rightOpp && (
                <SideOppSlot
                  player={rightOpp.p}
                  isActive={rightOpp.idx === gameState.currentTurnIndex}
                  side="right"
                />
              )}
            </View>
          </View>

          <View style={[styles.handSection, { height: HAND_SECTION_H }]}>
            {isFinished ? (
              <View style={styles.finishedRow}>
                <Ionicons name="trophy" size={18} color={Colors.gold} />
                <Text style={styles.finishedText}>
                  Hai finito! Aspetti gli altri...
                </Text>
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
          </View>
        </View>
      </View>

      <Pressable
        onPress={handlePass}
        disabled={!canPassNow}
        style={[
          styles.passBtn,
          {
            left: leftPad + TABLE_M - 2,
            bottom: bottomPad + TABLE_M - 2,
          },
          !canPassNow && styles.passBtnDim,
        ]}
      >
        <Text style={[styles.passBtnLabel, !canPassNow && styles.passBtnLabelDim]}>
          PASSA
        </Text>
      </Pressable>

      <Pressable
        onPress={playBtnValid ? handlePlay : undefined}
        style={[
          styles.playBtn,
          {
            right: rightPad + TABLE_M - 2,
            bottom: bottomPad + TABLE_M - 2,
          },
          !playBtnValid && styles.playBtnDim,
        ]}
      >
        {playBtnValid ? (
          <LinearGradient
            colors={[Colors.goldLight, Colors.gold, Colors.goldDark]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.playBtnGrad}
          >
            <Text style={styles.playBtnLabel}>GIOCA</Text>
            {selectedCards.length > 1 && (
              <Text style={styles.playBtnSub}>{selectedCards.length} carte</Text>
            )}
          </LinearGradient>
        ) : (
          <View style={[styles.playBtnGrad, styles.playBtnGradDim]}>
            <Text style={styles.playBtnLabelDim}>
              {!isHumanTurn || isFinished
                ? "GIOCA"
                : selectedCards.length === 0
                ? "GIOCA"
                : tentativeCombo === null
                ? "NON\nVALIDA"
                : "TROPPO\nBASSA"}
            </Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#031008",
  },

  topBar: {
    position: "absolute",
    height: TOP_BAR_H,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    gap: 8,
    zIndex: 10,
  },
  quitBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  turnPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.3)",
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
  cardCountBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  cardCountText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 15,
    color: Colors.gold,
  },

  table: {
    position: "absolute",
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 3,
    borderColor: "rgba(201,168,76,0.3)",
  },
  tableInnerBorder: {
    position: "absolute",
    top: 6,
    left: 6,
    right: 6,
    bottom: 6,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "rgba(201,168,76,0.12)",
  },
  tableContent: {
    flex: 1,
    flexDirection: "column",
  },

  topSection: {
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(201,168,76,0.08)",
  },
  topOppSlot: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
  },
  topOppRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  topOppAvatarCol: {
    alignItems: "center",
    gap: 3,
  },

  midSection: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  sideSection: {
    width: SIDE_SECTION_W,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  sideOppSlot: {
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  sideLeft: { flexDirection: "row" },
  sideRight: { flexDirection: "row-reverse" },
  sideOppAvatarCol: {
    alignItems: "center",
    gap: 3,
    marginHorizontal: 6,
  },

  centerSection: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  handSection: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: BTN_W + 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(201,168,76,0.08)",
  },

  oppName: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 10,
    color: "rgba(240,234,214,0.65)",
    maxWidth: 70,
    textAlign: "center",
  },

  avatarOuter: {
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  avatarOuterActive: {
    borderColor: Colors.gold,
    shadowColor: Colors.gold,
    shadowOpacity: 0.7,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  avatarInner: {
    backgroundColor: "rgba(11,59,37,0.95)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(201,168,76,0.18)",
  },
  avatarInitials: {
    fontFamily: "Rajdhani_700Bold",
    color: Colors.text,
    letterSpacing: 0.5,
  },
  countBubble: {
    position: "absolute",
    bottom: -3,
    right: -3,
    backgroundColor: "rgba(4,16,8,0.9)",
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
    borderWidth: 1,
    borderColor: "rgba(201,168,76,0.3)",
  },
  countBubbleText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 10,
    color: Colors.gold,
  },

  pileArea: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 80,
  },
  winnerTag: {
    position: "absolute",
    top: -28,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.goldMuted,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.goldDark,
    zIndex: 20,
  },
  winnerText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 11,
    color: Colors.gold,
  },
  emptyText: {
    fontFamily: "Rajdhani_500Medium",
    fontSize: 12,
    color: "rgba(240,234,214,0.18)",
  },
  pileStack: {
    alignItems: "center",
    justifyContent: "center",
  },
  pileLayer: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  pileCards: {
    flexDirection: "row",
    alignItems: "flex-end",
  },
  comboLabel: {
    marginTop: CARD_H + 12,
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

  handCenter: {
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
  finishedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  finishedText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 13,
    color: Colors.gold,
  },

  passBtn: {
    position: "absolute",
    width: BTN_W,
    height: BTN_H,
    borderRadius: BTN_H / 2,
    backgroundColor: "#5C1212",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2.5,
    borderColor: "#8B1A1A",
    zIndex: 20,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
  passBtnDim: {
    backgroundColor: "rgba(50,12,12,0.55)",
    borderColor: "rgba(100,20,20,0.35)",
    shadowOpacity: 0,
  },
  passBtnLabel: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 15,
    color: "#FF8080",
    letterSpacing: 1,
  },
  passBtnLabelDim: {
    color: "rgba(255,128,128,0.3)",
  },

  playBtn: {
    position: "absolute",
    width: BTN_W,
    height: BTN_H,
    borderRadius: BTN_H / 2,
    overflow: "hidden",
    zIndex: 20,
    shadowColor: Colors.gold,
    shadowOpacity: 0.5,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
  playBtnDim: {
    shadowOpacity: 0,
  },
  playBtnGrad: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
  },
  playBtnGradDim: {
    backgroundColor: "rgba(40,30,5,0.55)",
    borderWidth: 2.5,
    borderColor: "rgba(201,168,76,0.2)",
    borderRadius: BTN_H / 2,
  },
  playBtnLabel: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 15,
    color: "#0A1F10",
    letterSpacing: 1,
  },
  playBtnSub: {
    fontFamily: "Rajdhani_500Medium",
    fontSize: 9,
    color: "#0A1F10",
    opacity: 0.7,
  },
  playBtnLabelDim: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 11,
    color: "rgba(201,168,76,0.3)",
    letterSpacing: 0.5,
    textAlign: "center",
  },
});
