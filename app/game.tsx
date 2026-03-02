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
  Easing,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import * as ScreenOrientation from "expo-screen-orientation";
import { Ionicons } from "@expo/vector-icons";
import { useGame } from "@/context/GameContext";
import {
  buildCombination,
  canPlay,
  sortHand,
  Player,
} from "@/lib/gameEngine";
import {
  CARD_W,
  CARD_H,
  BTN_W,
  BTN_H,
  TOP_BAR_H,
  TABLE_M,
  SIDE_SECTION_W,
  TOP_SECTION_H,
  HAND_SECTION_H,
  FlyDirection,
  getOpponentPosition,
  TopOppSlot,
  SideOppSlot,
  FlyingCards,
  PlayedPile,
  StraightHand,
  sharedTableStyles,
  sharedStyles,
  portraitOverlayStyles,
} from "@/components/GameShared";
import {
  playCardSelect,
  playCardPlay,
  playCardPass,
  preloadSounds,
  unloadSounds,
} from "@/lib/sounds";
import type { Combination } from "@/lib/gameEngine";
import Colors from "@/constants/colors";

const AI_DELAY = 1100;
const HUMAN_TURN_SECONDS = 20;

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

  const humanIdx = gameState?.players.findIndex((p) => p.type === "human") ?? -1;
  const totalOpponents = (gameState?.players.length ?? 1) - 1;

  const [roundWinner, setRoundWinner] = useState<string | null>(null);
  const [playedPile, setPlayedPile] = useState<Combination[]>([]);
  const [timeLeft, setTimeLeft] = useState(HUMAN_TURN_SECONDS);
  const [flyInfo, setFlyInfo] = useState<{
    key: string;
    dir: FlyDirection;
    cards: Combination["cards"];
  } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevComboKeyRef = useRef<string>("");

  const handScaleVal = useSharedValue(1);
  const giocaPulseVal = useSharedValue(1);
  const passaPulseVal = useSharedValue(1);

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    preloadSounds();
    return () => {
      ScreenOrientation.unlockAsync();
      unloadSounds();
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
    if (combo !== null) {
      const comboKey =
        combo.cards.map((c) => c.id).join(",") + "_" + gameState.lastPlayedBy;
      if (comboKey !== prevComboKeyRef.current) {
        prevComboKeyRef.current = comboKey;
        setPlayedPile((prev) => [...prev.slice(-5), combo]);
        const playedBy = gameState.lastPlayedBy;
        let dir: FlyDirection;
        if (playedBy === humanIdx) {
          dir = "bottom";
        } else {
          const steps =
            ((playedBy - humanIdx + gameState.players.length) %
              gameState.players.length);
          dir = getOpponentPosition(steps, totalOpponents);
        }
        setFlyInfo({ key: comboKey, dir, cards: combo.cards });
      }
    } else {
      prevComboKeyRef.current = "";
      setPlayedPile([]);
    }
  }, [gameState?.lastPlayedCombination]);

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

  useEffect(() => {
    if (isHumanTurn && !isFinished) {
      handScaleVal.value = withSpring(1.025, { damping: 14, stiffness: 180 });
    } else {
      handScaleVal.value = withTiming(1, { duration: 250 });
    }
  }, [isHumanTurn, isFinished]);

  const prevSelectedLen = useRef(0);
  useEffect(() => {
    const hasSelection = selectedCards.length > 0 && isHumanTurn && !isFinished;
    if (hasSelection && prevSelectedLen.current !== selectedCards.length) {
      giocaPulseVal.value = withSequence(
        withTiming(1.1, { duration: 120 }),
        withSpring(1, { damping: 10, stiffness: 200 })
      );
    }
    prevSelectedLen.current = selectedCards.length;
  }, [selectedCards.length, isHumanTurn, isFinished]);

  useEffect(() => {
    const canPass =
      gameState?.lastPlayedCombination !== null && isHumanTurn && !isFinished;
    if (canPass) {
      passaPulseVal.value = withSequence(
        withTiming(1.08, { duration: 200 }),
        withSpring(1, { damping: 10, stiffness: 180 })
      );
    }
  }, [gameState?.lastPlayedCombination, isHumanTurn, isFinished]);

  const handSectionAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: handScaleVal.value }],
  }));
  const giocaAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: giocaPulseVal.value }],
  }));
  const passaAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: passaPulseVal.value }],
  }));

  useEffect(() => {
    if (!gameState) router.replace("/");
  }, [gameState]);

  if (!gameState) return null;

  const humanPlayer = gameState.players[humanIdx];
  const currentPlayer = gameState.players[gameState.currentTurnIndex];
  const isNewRound = gameState.lastPlayedCombination === null;

  const sortedHand = sortHand(humanPlayer?.hand ?? []);
  const selectedObjs = sortedHand.filter((c) => selectedCards.includes(c.id));
  const tentativeCombo =
    selectedObjs.length > 0 ? buildCombination(selectedObjs) : null;
  const requires3Spades = !gameState.firstPlayMade;
  const isValidPlay =
    tentativeCombo !== null &&
    canPlay(
      tentativeCombo,
      isNewRound ? null : gameState.lastPlayedCombination
    ) &&
    (!requires3Spades ||
      tentativeCombo.cards.some(
        (c) => c.rank === "3" && c.suit === "spades"
      ));
  const canPassNow = !isNewRound && isHumanTurn && !isFinished;
  const playBtnValid = isValidPlay && isHumanTurn && !isFinished;

  const opponents = gameState.players
    .map((p, idx) => ({ p, idx }))
    .filter(({ idx }) => idx !== humanIdx);

  const handlePlay = () => {
    if (!playBtnValid) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    playCardPlay();
    playSelected();
  };
  const handlePass = () => {
    if (!canPassNow) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    playCardPass();
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
    playCardSelect();
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

  const topOpp = opponents.find(({ idx }) => {
    const steps =
      ((idx - humanIdx + gameState.players.length) %
        gameState.players.length);
    return getOpponentPosition(steps, totalOpponents) === "top";
  });
  const leftOpp = opponents.find(({ idx }) => {
    const steps =
      ((idx - humanIdx + gameState.players.length) %
        gameState.players.length);
    return getOpponentPosition(steps, totalOpponents) === "left";
  });
  const rightOpp = opponents.find(({ idx }) => {
    const steps =
      ((idx - humanIdx + gameState.players.length) %
        gameState.players.length);
    return getOpponentPosition(steps, totalOpponents) === "right";
  });

  const handAvailW = tableW - (BTN_W + 10) * 2;

  return (
    <View style={localStyles.root}>
      <LinearGradient
        colors={["#031008", "#072A18", "#031008"]}
        style={StyleSheet.absoluteFill}
      />

      <View
        style={[
          localStyles.topBar,
          { top: topPad, left: leftPad, right: rightPad },
        ]}
      >
        <Pressable onPress={handleQuit} style={localStyles.quitBtn} hitSlop={10}>
          <Ionicons name="close" size={17} color="rgba(240,234,214,0.5)" />
        </Pressable>
        <View style={localStyles.turnPill}>
          <View
            style={[
              localStyles.turnDot,
              {
                backgroundColor: isHumanTurn ? Colors.gold : Colors.accent,
              },
            ]}
          />
          <Text style={localStyles.turnText} numberOfLines={1}>
            {isHumanTurn
              ? isFinished
                ? "Aspetti gli altri..."
                : "Il tuo turno"
              : `${currentPlayer.name} pensa...`}
          </Text>
          {isHumanTurn && !isFinished && (
            <Text
              style={[
                localStyles.timerNum,
                urgent && localStyles.timerUrgent,
              ]}
            >
              {timeLeft}
            </Text>
          )}
        </View>
        <View style={localStyles.cardCountBadge}>
          <Text style={localStyles.cardCountText}>
            {humanPlayer?.hand.length ?? 0}
          </Text>
        </View>
      </View>

      <View
        testID="game-table"
        style={[
          sharedTableStyles.table,
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
        <View style={sharedTableStyles.tableInnerBorder} />

        <View style={sharedTableStyles.tableContent}>
          <View
            style={[sharedTableStyles.topSection, { height: TOP_SECTION_H }]}
          >
            {topOpp ? (
              <TopOppSlot
                player={topOpp.p}
                isActive={topOpp.idx === gameState.currentTurnIndex}
              />
            ) : (
              <View />
            )}
          </View>

          <View style={sharedTableStyles.midSection}>
            <View style={sharedTableStyles.sideSection}>
              {leftOpp && (
                <SideOppSlot
                  player={leftOpp.p}
                  isActive={leftOpp.idx === gameState.currentTurnIndex}
                  side="left"
                />
              )}
            </View>

            <View style={sharedTableStyles.centerSection}>
              <PlayedPile history={playedPile} roundWinner={roundWinner} />
            </View>

            <View style={sharedTableStyles.sideSection}>
              {rightOpp && (
                <SideOppSlot
                  player={rightOpp.p}
                  isActive={rightOpp.idx === gameState.currentTurnIndex}
                  side="right"
                />
              )}
            </View>
          </View>

          <Animated.View
            style={[
              sharedTableStyles.handSection,
              { height: HAND_SECTION_H },
              handSectionAnimStyle,
            ]}
          >
            {isFinished ? (
              <View style={localStyles.finishedRow}>
                <Ionicons name="trophy" size={18} color={Colors.gold} />
                <Text style={localStyles.finishedText}>
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
          </Animated.View>
        </View>
      </View>

      <Animated.View
        style={[
          localStyles.passBtn,
          { left: leftPad + TABLE_M - 2, bottom: bottomPad + TABLE_M - 2 },
          !canPassNow && localStyles.passBtnDim,
          passaAnimStyle,
        ]}
      >
        <Pressable
          testID="btn-passa"
          onPress={handlePass}
          disabled={!canPassNow}
          style={StyleSheet.absoluteFill}
        >
          <View style={localStyles.passBtnInner}>
            <Text
              style={[
                localStyles.passBtnLabel,
                !canPassNow && localStyles.passBtnLabelDim,
              ]}
            >
              PASSA
            </Text>
          </View>
        </Pressable>
      </Animated.View>

      <Animated.View
        style={[
          localStyles.playBtn,
          { right: rightPad + TABLE_M - 2, bottom: bottomPad + TABLE_M - 2 },
          !playBtnValid && localStyles.playBtnDim,
          giocaAnimStyle,
        ]}
      >
        <Pressable
          testID="btn-gioca"
          onPress={playBtnValid ? handlePlay : undefined}
          style={StyleSheet.absoluteFill}
        >
          {playBtnValid ? (
            <LinearGradient
              colors={[Colors.goldLight, Colors.gold, Colors.goldDark]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={localStyles.playBtnGrad}
            >
              <Text style={localStyles.playBtnLabel}>GIOCA</Text>
              {selectedCards.length > 1 && (
                <Text style={localStyles.playBtnSub}>
                  {selectedCards.length} carte
                </Text>
              )}
            </LinearGradient>
          ) : (
            <View style={[localStyles.playBtnGrad, localStyles.playBtnGradDim]}>
              <Text style={localStyles.playBtnLabelDim}>
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
      </Animated.View>

      {flyInfo && (
        <FlyingCards
          key={flyInfo.key}
          cards={flyInfo.cards}
          direction={flyInfo.dir}
          onDone={() => setFlyInfo(null)}
        />
      )}

      {W < H && (
        <View style={portraitOverlayStyles.overlay}>
          <View style={portraitOverlayStyles.card}>
            <Ionicons
              name="phone-landscape-outline"
              size={56}
              color={Colors.gold}
            />
            <Text style={portraitOverlayStyles.title}>
              Ruota il dispositivo
            </Text>
            <Text style={portraitOverlayStyles.sub}>
              Il gioco richiede la modalità orizzontale
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const localStyles = StyleSheet.create({
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
  passBtnLabelDim: { color: "rgba(255,128,128,0.3)" },
  passBtnInner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
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
  playBtnDim: { shadowOpacity: 0 },
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
