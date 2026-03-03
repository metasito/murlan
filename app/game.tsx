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
  cardStrength,
  type StartReason,
  type Card,
} from "@/lib/gameEngine";
import {
  CARD_W,
  CARD_H,
  BTN_W,
  BTN_H,
  SIDE_BTN_W,
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
  StartReasonBanner,
  useTurnPulse,
  GameBillboard,
  getComboLabel,
} from "@/components/GameShared";
import { ExchangeModal } from "@/components/ExchangeModal";
import { ExchangeAnnouncement } from "@/components/ExchangeAnnouncement";
import {
  playCardSelect,
  playCardPlay,
  playCardPass,
  playYourTurn,
  playRoundStart,
  playRoundWin,
  playUrgentTick,
  playBomb,
  playGameWin,
  playGameLose,
  playDeal,
  playExchange,
  preloadSounds,
  unloadSounds,
} from "@/lib/sounds";
import type { Combination } from "@/lib/gameEngine";
import Colors from "@/constants/colors";

const AI_DELAY = 1100;
const HUMAN_TURN_SECONDS = 20;

const EXCHANGE_VALID_RANKS = new Set(["3","4","5","6","7","8","9","10"]);

function formatSpadeLabel(card: Card): string {
  return `${card.rank}♠`;
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
    chooseExchangeCard,
    exchangeAnnouncing,
    exchangeAnnounceData,
    acknowledgeExchange,
  } = useGame();

  // Keep refs to latest functions to avoid stale closures in timers
  const runAITurnRef = useRef(runAITurn);
  runAITurnRef.current = runAITurn;
  const passTurnRef = useRef(passTurn);
  passTurnRef.current = passTurn;
  const chooseExchangeRef = useRef(chooseExchangeCard);
  chooseExchangeRef.current = chooseExchangeCard;

  const humanIdx = gameState?.players.findIndex((p) => p.type === "human") ?? -1;
  const totalOpponents = (gameState?.players.length ?? 1) - 1;

  const [roundWinner, setRoundWinner] = useState<string | null>(null);
  const [pileState, setPileState] = useState<{ prev: Combination | null; current: Combination | null }>({ prev: null, current: null });
  const [timeLeft, setTimeLeft] = useState(HUMAN_TURN_SECONDS);
  const [flyInfo, setFlyInfo] = useState<{
    key: string;
    dir: FlyDirection;
    cards: Combination["cards"];
  } | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevComboKeyRef = useRef<string>("");
  const prevIsHumanTurnRef = useRef(false);
  const prevExchangeActiveRef = useRef(false);
  const prevGameOverRef = useRef(false);

  const handScaleVal = useSharedValue(1);
  const giocaPulseVal = useSharedValue(1);
  const passaPulseVal = useSharedValue(1);

  // Lock to landscape & preload sounds
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    preloadSounds().then(() => playDeal());
    return () => {
      ScreenOrientation.unlockAsync();
      unloadSounds();
    };
  }, []);

  // AI turn trigger
  useEffect(() => {
    if (!gameState) return;
    if (gameState.gameOver) {
      setTimeout(() => router.replace("/result"), 800);
      return;
    }
    if (gameState.exchangePhase?.active) return;
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
    gameState?.exchangePhase?.active,
  ]);

  // Auto-handle AI exchange
  useEffect(() => {
    if (!gameState?.exchangePhase?.active) return;
    const { winnerIdx } = gameState.exchangePhase;
    const winner = gameState.players[winnerIdx];
    if (winner.type !== "ai") return;
    const validCards = winner.hand
      .filter((c) => EXCHANGE_VALID_RANKS.has(c.rank))
      .sort((a, b) => cardStrength(a) - cardStrength(b));
    if (validCards.length > 0) {
      const t = setTimeout(() => {
        chooseExchangeRef.current(validCards[0].id);
      }, 600);
      return () => clearTimeout(t);
    }
  }, [gameState?.exchangePhase?.active]);

  // Round winner banner
  useEffect(() => {
    if (lastRoundWinner !== null && gameState) {
      const name = gameState.players[lastRoundWinner]?.name ?? "";
      setRoundWinner(name);
      playRoundWin();
      const t = setTimeout(() => setRoundWinner(null), 1800);
      return () => clearTimeout(t);
    }
  }, [lastRoundWinner]);

  // Flying card animation + pile state — derived directly from game state (no race condition)
  useEffect(() => {
    if (!gameState) return;
    const combo = gameState.lastPlayedCombination;
    if (combo !== null) {
      const comboKey =
        combo.cards.map((c) => c.id).join(",") + "_" + gameState.lastPlayedBy;
      if (comboKey !== prevComboKeyRef.current) {
        prevComboKeyRef.current = comboKey;
        // Update pile immediately — old current becomes prev, new combo is current
        setPileState((s) => ({ prev: s.current, current: combo }));
        // Play bomb sound for special combos
        if (combo.type === "bomb" || combo.type === "royal_straight") {
          playBomb();
        }
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
      setPileState({ prev: null, current: null });
      setFlyInfo(null);
    }
  }, [gameState?.lastPlayedCombination]);

  const isHumanTurn = gameState ? gameState.currentTurnIndex === humanIdx : false;
  const isFinished = gameState
    ? gameState.players[humanIdx]?.finishPosition !== undefined
    : false;
  const isNewRound = gameState ? gameState.lastPlayedCombination === null : true;
  // Timer only active when human must respond to a played combo
  const shouldRunTimer = isHumanTurn && !isFinished && !isNewRound &&
    !!gameState && !gameState.gameOver && !gameState.exchangePhase?.active;

  // Fixed timer — no side effects inside state updater
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!shouldRunTimer) {
      setTimeLeft(HUMAN_TURN_SECONDS);
      return;
    }
    let remaining = HUMAN_TURN_SECONDS;
    setTimeLeft(remaining);
    timerRef.current = setInterval(() => {
      remaining -= 1;
      setTimeLeft(remaining);
      if (remaining <= 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        passTurnRef.current();
      }
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [shouldRunTimer, gameState?.currentTurnIndex]);

  // Sound: your turn
  useEffect(() => {
    if (isHumanTurn && !isFinished && !prevIsHumanTurnRef.current) {
      playYourTurn();
    }
    prevIsHumanTurnRef.current = isHumanTurn;
  }, [isHumanTurn, isFinished]);

  // Sound: new round started
  const prevLastPlayed = useRef(gameState?.lastPlayedCombination);
  useEffect(() => {
    if (
      gameState?.lastPlayedCombination === null &&
      prevLastPlayed.current !== null &&
      prevLastPlayed.current !== undefined
    ) {
      playRoundStart();
    }
    prevLastPlayed.current = gameState?.lastPlayedCombination;
  }, [gameState?.lastPlayedCombination]);

  // Sound: urgent tick — one per second when timer ≤5
  const urgent = timeLeft <= 5 && shouldRunTimer;
  useEffect(() => {
    if (urgent) playUrgentTick();
  }, [timeLeft]);

  // Sound: exchange phase started
  useEffect(() => {
    const exchangeActive = gameState?.exchangePhase?.active === true;
    if (exchangeActive && !prevExchangeActiveRef.current) {
      playExchange();
    }
    prevExchangeActiveRef.current = exchangeActive;
  }, [gameState?.exchangePhase?.active]);

  // Sound: game over (win or lose)
  useEffect(() => {
    if (!gameState?.gameOver || prevGameOverRef.current) return;
    prevGameOverRef.current = true;
    const humanPlayer = gameState.players[humanIdx];
    if (humanPlayer?.finishPosition === 1) {
      playGameWin();
    } else if (humanPlayer?.finishPosition === gameState.players.length) {
      playGameLose();
    }
  }, [gameState?.gameOver]);

  // Hand scale animation — stays zoomed while it's the human's turn
  useEffect(() => {
    if (isHumanTurn && !isFinished) {
      handScaleVal.value = withSpring(1.02, { damping: 12, stiffness: 160 });
    } else {
      handScaleVal.value = withTiming(1, { duration: 280 });
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
    const canPass = !isNewRound && isHumanTurn && !isFinished;
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
  const turnPulseStyle = useTurnPulse(isHumanTurn && !isFinished && !gameState?.exchangePhase?.active);

  useEffect(() => {
    if (!gameState) router.replace("/");
  }, [gameState]);

  if (!gameState) return null;

  const humanPlayer = gameState.players[humanIdx];
  const currentPlayer = gameState.players[gameState.currentTurnIndex];

  const sortedHand = sortHand(humanPlayer?.hand ?? []);
  const selectedObjs = sortedHand.filter((c) => selectedCards.includes(c.id));
  const tentativeCombo =
    selectedObjs.length > 0 ? buildCombination(selectedObjs) : null;
  const requiresStartCard = !gameState.firstPlayMade && !!gameState.startCard;
  const isValidPlay =
    tentativeCombo !== null &&
    canPlay(
      tentativeCombo,
      isNewRound ? null : gameState.lastPlayedCombination
    ) &&
    (!requiresStartCard ||
      tentativeCombo.cards.some(
        (c) => c.id === gameState.startCard!.id
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

  const handAvailW = tableW - (SIDE_BTN_W + 8) * 2 - 8;

  // Exchange phase — human winner must give back a weak card
  const exchangeActive = gameState.exchangePhase?.active === true;
  const exchangeWinner = exchangeActive
    ? gameState.players[gameState.exchangePhase!.winnerIdx]
    : null;
  const exchangeLoser = exchangeActive
    ? gameState.players[gameState.exchangePhase!.loserIdx]
    : null;
  const isHumanExchange =
    exchangeActive &&
    gameState.exchangePhase!.winnerIdx === humanIdx &&
    exchangeWinner?.type === "human";

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
        <GameBillboard
          roundLabel="Partita"
          currentComboLabel={getComboLabel(pileState.current)}
          currentTurnName={currentPlayer.name}
          isLocalPlayerTurn={isHumanTurn && !isFinished}
        />
        {shouldRunTimer && (
          <Text style={[localStyles.timerNum, urgent && localStyles.timerUrgent]}>
            {timeLeft}
          </Text>
        )}
        <View style={localStyles.cardCountBadge}>
          <Text style={localStyles.cardCountText}>
            {humanPlayer?.hand.length ?? 0}
          </Text>
        </View>
      </View>

      {/* Table background — clips to rounded corners, decoration only */}
      <View
        style={[
          sharedTableStyles.tableBg,
          { left: tableLeft, top: tableTop, right: tableRight, bottom: tableBottom },
        ]}
      >
        <LinearGradient
          colors={["#0D4A2E", Colors.felt, "#082B1A"]}
          locations={[0, 0.5, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={sharedTableStyles.tableInnerBorder} />
      </View>

      {/* Table overlay — same coords, overflow visible so buttons/slots can extend outside */}
      <View
        testID="game-table"
        style={[
          sharedTableStyles.tableOverlay,
          { left: tableLeft, top: tableTop, right: tableRight, bottom: tableBottom },
        ]}
      >
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
              {!gameState.firstPlayMade && gameState.startCard && (
                <View style={localStyles.threeSpadesBanner}>
                  <Text style={localStyles.threeSpadesEmoji}>♠</Text>
                  <Text style={localStyles.threeSpadesText}>
                    {(() => {
                      const sc = gameState.startCard!;
                      const starter = gameState.players[gameState.currentTurnIndex];
                      const cardLabel = `${sc.rank === "J" ? "J" : sc.rank === "Q" ? "Q" : sc.rank === "K" ? "K" : sc.rank === "A" ? "A" : sc.rank}♠`;
                      return starter.type === "human"
                        ? `Inizi tu! Hai il ${cardLabel}`
                        : `${starter.name} inizia con il ${cardLabel}`;
                    })()}
                  </Text>
                </View>
              )}
              {gameState.firstPlayMade && (
                <PlayedPile
                  prev={pileState.prev}
                  current={flyInfo ? null : pileState.current}
                  roundWinner={roundWinner}
                />
              )}
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
              isHumanTurn && !isFinished && sharedTableStyles.handSectionActive,
              { height: HAND_SECTION_H },
              handSectionAnimStyle,
              turnPulseStyle,
            ]}
          >
            {/* PASSA — left side of hand row */}
            <Animated.View style={[localStyles.passBtn, !canPassNow && localStyles.passBtnDim, passaAnimStyle]}>
              <Pressable
                testID="btn-passa"
                onPress={handlePass}
                disabled={!canPassNow}
                style={localStyles.passBtnInner}
              >
                <Text style={[localStyles.passBtnLabel, !canPassNow && localStyles.passBtnLabelDim]}>
                  PASSA
                </Text>
              </Pressable>
            </Animated.View>

            {/* Hand cards */}
            {isFinished ? (
              <View style={[localStyles.finishedRow, { flex: 1 }]}>
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
                isMyTurn={isHumanTurn && !isFinished}
              />
            )}

            {/* GIOCA — right side of hand row */}
            <Animated.View style={[localStyles.playBtn, !playBtnValid && localStyles.playBtnDim, giocaAnimStyle]}>
              <Pressable
                testID="btn-gioca"
                onPress={playBtnValid ? handlePlay : undefined}
                style={localStyles.playBtnInner}
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
                        {selectedCards.length}c
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
          </Animated.View>
        </View>
      </View>

      {flyInfo && (
        <FlyingCards
          key={flyInfo.key}
          cards={flyInfo.cards}
          direction={flyInfo.dir}
          onDone={() => setFlyInfo(null)}
        />
      )}

      {/* Start reason banner — shown at round start, dismisses after 4s or on tap */}
      {gameState.startReason && (
        <StartReasonBanner
          key={`reason-${gameState.startReason.type}-${gameState.startReason.playerIdx}`}
          reason={gameState.startReason}
          players={gameState.players}
          topOffset={topPad + TOP_BAR_H + TABLE_M + 8}
        />
      )}

      {/* Exchange phase overlay — human winner must give a weak card */}
      {isHumanExchange && exchangeLoser && (
        <ExchangeModal
          phase={gameState.exchangePhase!}
          winnerHand={gameState.players[gameState.exchangePhase!.winnerIdx].hand}
          loserName={exchangeLoser.name}
          onSelectCard={(cardId) => {
            playCardPlay();
            chooseExchangeCard(cardId);
          }}
        />
      )}

      {/* Post-exchange announcement */}
      {exchangeAnnounceData && (
        <ExchangeAnnouncement
          visible={exchangeAnnouncing}
          winnerName={exchangeAnnounceData.winnerName}
          loserName={exchangeAnnounceData.loserName}
          bothJokersException={exchangeAnnounceData.bothJokersException}
          cardGiven={exchangeAnnounceData.cardGiven}
          cardReceived={exchangeAnnounceData.cardReceived}
          onDismiss={acknowledgeExchange}
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
  threeSpadesBanner: {
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.35)",
    borderWidth: 1,
    borderColor: "rgba(201,168,76,0.25)",
  },
  threeSpadesEmoji: {
    fontSize: 28,
    color: Colors.text,
  },
  threeSpadesText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 13,
    color: Colors.text,
    textAlign: "center",
    letterSpacing: 0.5,
  },

  passBtn: {
    width: SIDE_BTN_W,
    height: CARD_H,
    borderRadius: 12,
    backgroundColor: "#5C1212",
    borderWidth: 2,
    borderColor: "#8B1A1A",
    marginHorizontal: 3,
    overflow: "hidden",
  },
  passBtnDim: {
    backgroundColor: "rgba(50,12,12,0.55)",
    borderColor: "rgba(100,20,20,0.35)",
  },
  passBtnLabel: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 13,
    color: "#FF8080",
    letterSpacing: 0.5,
  },
  passBtnLabelDim: { color: "rgba(255,128,128,0.3)" },
  passBtnInner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  playBtn: {
    width: SIDE_BTN_W + 6,
    height: CARD_H,
    borderRadius: 12,
    overflow: "hidden",
    marginHorizontal: 3,
  },
  playBtnDim: { opacity: 0.55 },
  playBtnInner: {
    flex: 1,
  },
  playBtnGrad: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  playBtnGradDim: {
    backgroundColor: "rgba(40,30,5,0.7)",
    borderWidth: 2,
    borderColor: "rgba(201,168,76,0.2)",
    borderRadius: 12,
  },
  playBtnLabel: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 13,
    color: "#0A1F10",
    letterSpacing: 0.5,
  },
  playBtnSub: {
    fontFamily: "Rajdhani_500Medium",
    fontSize: 10,
    color: "#0A1F10",
    opacity: 0.7,
  },
  playBtnLabelDim: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 10,
    color: "rgba(201,168,76,0.4)",
    letterSpacing: 0.5,
    textAlign: "center",
  },

});
