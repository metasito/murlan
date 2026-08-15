// The one presentational game table.
//
// app/game.tsx (offline, local engine) and app/(online)/game.tsx (online,
// server-authoritative socket state) were ~2,400 lines of parallel
// implementation of this. They are now thin adapters: each maps its own state
// source onto `GameTableProps` and passes its own extras through the slots.
// Nothing below knows or cares which mode it is running in.
//
// Where the two modes genuinely differ the difference is an explicit prop or a
// slot (`topBarExtra`, `banners`, `overlays`, `turnTimer`) — never an
// `isOnline &&` branch threaded through the render.

import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  withSequence,
  withRepeat,
  cancelAnimation,
  Easing,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import * as ScreenOrientation from "expo-screen-orientation";
import { Ionicons } from "@expo/vector-icons";
import {
  buildCombination,
  canPlay,
  sortHand,
  type Card,
  type GameState,
} from "@/lib/gameEngine";
import type { ExchangeAnnounceData } from "@/lib/sharedGameFlow";
import {
  TOP_BAR_H,
  TOP_SECTION_H,
  HAND_SECTION_H,
  CARD_H,
  SIDE_BTN_W,
  TABLE_M,
  advancePile,
  arrangeOpponents,
  canPassNow as canPassNowOf,
  comboKey,
  computeTableFrame,
  EMPTY_PILE,
  handCountOf,
  playButtonLabel,
  readExchange,
  seatDirection,
  startCardBannerText,
  turnTimerActive,
  type FlyDirection,
  type PileState,
} from "@/components/gameTableModel";
import {
  TopOppSlot,
  SideOppSlot,
  FlyingCards,
  PlayedPile,
  StraightHand,
  TableVignette,
  sharedTableStyles,
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
import { hapticLight, hapticMedium, hapticSelection, hapticSuccess } from "@/lib/haptics";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { Colors, FontSize, Motion, Radius, Spacing } from "@/lib/theme";

// How long the round-winner tag stays over the pile. A domain beat, not a
// generic UI transition, so it is not a Motion token.
const ROUND_WINNER_MS = 1800;
// Below this the countdown turns red and ticks audibly.
const URGENT_SECONDS = 5;

export interface TurnTimerConfig {
  /** Length of the countdown, in seconds. */
  seconds: number;
  /**
   * Count down while leading a new round too. False offline (leading has no
   * deadline); true online, where the server arms its AFK timer every turn.
   */
  includeNewRound?: boolean;
  /**
   * Called when the countdown reaches zero. Offline this auto-passes locally;
   * online it is omitted, because the server owns the timeout and the client
   * countdown is only a display of it.
   */
  onExpire?: () => void;
}

export interface ExchangeAnnouncementSlot {
  visible: boolean;
  data: ExchangeAnnounceData | null;
  onDismiss: () => void;
}

export interface GameTableProps {
  /**
   * The game, from whichever authority owns it. Offline this is the local
   * engine's state; online it is the server's, sanitized for this viewer
   * (opponents' hands blanked, `handCount` shipped alongside).
   */
  gameState: GameState;
  /** Seat the table is drawn from. Always rendered at the bottom. */
  viewerSeat: number;

  selectedIds: string[];
  onSelectCard: (cardId: string) => void;
  /** Only ever called with a selection that is a legal play. */
  onPlay: (cardIds: string[]) => void;
  onPass: () => void;
  onQuit: () => void;
  onExchangeGive: (cardId: string) => void;

  /** Small mode label under the combination in the billboard. */
  roundLabel: string;
  turnTimer?: TurnTimerConfig;
  exchangeAnnouncement?: ExchangeAnnouncementSlot;

  /** Extra controls at the right end of the top bar (online: reactions). */
  topBarExtra?: React.ReactNode;
  /** Transient strips under the top bar (online: reconnect notice). */
  banners?: React.ReactNode;
  /** Full-screen layers above the table (game over, error toasts, waiting states). */
  overlays?: React.ReactNode;
}

// ─── Turn countdown ───────────────────────────────────────────────────────────
//
// Its own component so the once-a-second tick re-renders a single <Text> and
// not the whole board — which, with hands of up to 27 cards, matters.

function TurnTimer({
  seconds,
  active,
  resetKey,
  onExpire,
}: {
  seconds: number;
  active: boolean;
  /** Restarts the countdown whenever it changes — one full clock per turn. */
  resetKey: string;
  onExpire?: () => void;
}) {
  const [timeLeft, setTimeLeft] = useState(seconds);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (!active) {
      setTimeLeft(seconds);
      return;
    }
    let remaining = seconds;
    setTimeLeft(remaining);
    const id = setInterval(() => {
      remaining -= 1;
      setTimeLeft(remaining);
      if (remaining <= URGENT_SECONDS && remaining >= 0) playUrgentTick();
      if (remaining <= 0) {
        clearInterval(id);
        onExpireRef.current?.();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [active, resetKey, seconds]);

  if (!active) return null;
  return (
    <Text
      style={[styles.timerNum, timeLeft <= URGENT_SECONDS && styles.timerUrgent]}
      accessibilityLiveRegion="polite"
    >
      {timeLeft}
    </Text>
  );
}

// ─── GameTable ────────────────────────────────────────────────────────────────

export function GameTable({
  gameState,
  viewerSeat,
  selectedIds,
  onSelectCard,
  onPlay,
  onPass,
  onQuit,
  onExchangeGive,
  roundLabel,
  turnTimer,
  exchangeAnnouncement,
  topBarExtra,
  banners,
  overlays,
}: GameTableProps) {
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const reduceMotion = usePrefersReducedMotion();

  const [roundWinner, setRoundWinner] = useState<string | null>(null);
  const [pileState, setPileState] = useState<PileState>(EMPTY_PILE);
  const [pileBounceTrigger, setPileBounceTrigger] = useState(0);
  const [flyInfo, setFlyInfo] = useState<{
    key: string;
    dir: FlyDirection;
    cards: Card[];
  } | null>(null);

  const prevComboKeyRef = useRef<string>("");
  const prevRoundWinnerRef = useRef<number | null>(null);
  const prevMyTurnRef = useRef(false);
  const prevExchangeActiveRef = useRef(false);
  const prevGameOverRef = useRef(false);

  const handScaleVal = useSharedValue(1);
  const giocaPulseVal = useSharedValue(1);
  const passaPulseVal = useSharedValue(1);
  const giocaGlowVal = useSharedValue(0);
  const shakeX = useSharedValue(0);

  // ── Derived view of the game ────────────────────────────────────────────────

  const players = gameState.players;
  const viewer = players[viewerSeat];
  const isMyTurn = gameState.currentTurnIndex === viewerSeat;
  const isFinished = viewer?.finishPosition !== undefined;
  const isNewRound = gameState.lastPlayedCombination === null;
  const exchange = readExchange(gameState, viewerSeat);

  const sortedHand = React.useMemo(() => sortHand(viewer?.hand ?? []), [viewer?.hand]);
  const selectedObjs = React.useMemo(
    () => sortedHand.filter((c) => selectedIds.includes(c.id)),
    [sortedHand, selectedIds]
  );
  const tentativeCombo = React.useMemo(
    () => (selectedObjs.length > 0 ? buildCombination(selectedObjs) : null),
    [selectedObjs]
  );
  const requiresStartCard = !gameState.firstPlayMade && !!gameState.startCard;
  const isValidPlay =
    tentativeCombo !== null &&
    canPlay(tentativeCombo, isNewRound ? null : gameState.lastPlayedCombination) &&
    (!requiresStartCard ||
      tentativeCombo.cards.some((c) => c.id === gameState.startCard!.id));

  const canPass = canPassNowOf({ isMyTurn, isFinished, isNewRound });
  const playBtnValid = isValidPlay && isMyTurn && !isFinished;

  const opponents = React.useMemo(
    () => arrangeOpponents(players, viewerSeat),
    [players, viewerSeat]
  );

  const frame = computeTableFrame({
    width: W,
    insets,
    isWeb: Platform.OS === "web",
  });

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    preloadSounds().then(() => playDeal());
    return () => {
      ScreenOrientation.unlockAsync();
      unloadSounds();
    };
  }, []);

  // Flying card + pile state, derived straight from the game state so a card
  // can never be shown twice or dropped. CLAUDE.md marks this load-bearing.
  useEffect(() => {
    const combo = gameState.lastPlayedCombination;
    if (combo === null) {
      if (prevComboKeyRef.current !== "") playRoundStart();
      prevComboKeyRef.current = "";
      setPileState(EMPTY_PILE);
      setFlyInfo(null);
      return;
    }
    const key = comboKey(combo, gameState.lastPlayedBy);
    if (key === prevComboKeyRef.current) return;
    prevComboKeyRef.current = key;
    setPileState((s) => advancePile(s, combo));
    if (combo.type === "bomb" || combo.type === "royal_straight") {
      playBomb();
      if (!reduceMotion) {
        shakeX.value = withSequence(
          withTiming(5, { duration: 45 }),
          withTiming(-5, { duration: 45 }),
          withTiming(4, { duration: 40 }),
          withTiming(-4, { duration: 40 }),
          withTiming(2, { duration: 35 }),
          withTiming(-2, { duration: 35 }),
          withTiming(0, { duration: 30 })
        );
      }
    }
    setFlyInfo({
      key,
      dir: seatDirection(gameState.lastPlayedBy, viewerSeat, players.length),
      cards: combo.cards,
    });
  }, [gameState.lastPlayedCombination]);

  // Round-winner tag over the pile.
  useEffect(() => {
    const winner = gameState.roundWinner;
    if (winner === null || winner === undefined) return;
    if (winner === prevRoundWinnerRef.current) return;
    prevRoundWinnerRef.current = winner;
    setRoundWinner(players[winner]?.name ?? "");
    playRoundWin();
    const t = setTimeout(() => setRoundWinner(null), ROUND_WINNER_MS);
    return () => clearTimeout(t);
  }, [gameState.roundWinner, gameState.lastPlayedCombination]);

  useEffect(() => {
    if (isMyTurn && !isFinished && !prevMyTurnRef.current) playYourTurn();
    prevMyTurnRef.current = isMyTurn;
  }, [isMyTurn, isFinished]);

  useEffect(() => {
    if (exchange.active && !prevExchangeActiveRef.current) playExchange();
    prevExchangeActiveRef.current = exchange.active;
  }, [exchange.active]);

  useEffect(() => {
    // Reset on the way back down so a rematch — which never unmounts this
    // component — gets its own win/lose sting instead of staying silent.
    if (!gameState.gameOver) {
      prevGameOverRef.current = false;
      return;
    }
    if (prevGameOverRef.current) return;
    prevGameOverRef.current = true;
    hapticSuccess();
    const myName = viewer?.name;
    const myRank = myName ? gameState.rankings.indexOf(myName) : -1;
    if (myRank === 0) playGameWin();
    else if (myRank >= 0 && myRank === gameState.rankings.length - 1) playGameLose();
  }, [gameState.gameOver]);

  // ── Animation ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (reduceMotion) {
      handScaleVal.value = 1;
      return;
    }
    handScaleVal.value =
      isMyTurn && !isFinished
        ? withSpring(1.02, { damping: 12, stiffness: 160 })
        : withTiming(1, { duration: Motion.duration.moderate });
  }, [isMyTurn, isFinished, reduceMotion]);

  // GIOCA bloom — a slow gold pulse while the button is armed.
  useEffect(() => {
    if (playBtnValid && !reduceMotion) {
      giocaGlowVal.value = withRepeat(
        withSequence(
          withTiming(1.0, { duration: 1000, easing: Easing.inOut(Easing.sin) }),
          withTiming(0.35, { duration: 1000, easing: Easing.inOut(Easing.sin) })
        ),
        -1,
        false
      );
    } else {
      cancelAnimation(giocaGlowVal);
      giocaGlowVal.value =
        reduceMotion && playBtnValid
          ? 0.6
          : withTiming(0, { duration: Motion.duration.fast });
    }
    return () => {
      cancelAnimation(giocaGlowVal);
    };
  }, [playBtnValid, reduceMotion]);

  // GIOCA pop as the selection grows or shrinks.
  const prevSelectedLen = useRef(0);
  useEffect(() => {
    const hasSelection = selectedIds.length > 0 && isMyTurn && !isFinished;
    if (hasSelection && prevSelectedLen.current !== selectedIds.length && !reduceMotion) {
      giocaPulseVal.value = withSequence(
        withTiming(1.1, { duration: Motion.duration.fast }),
        withSpring(1, Motion.spring.settle)
      );
    }
    prevSelectedLen.current = selectedIds.length;
  }, [selectedIds.length, isMyTurn, isFinished, reduceMotion]);

  // PASSA pop the moment passing becomes possible.
  useEffect(() => {
    if (canPass && !reduceMotion) {
      passaPulseVal.value = withSequence(
        withTiming(1.08, { duration: Motion.duration.base }),
        withSpring(1, Motion.spring.gentle)
      );
    }
  }, [gameState.lastPlayedCombination, isMyTurn, isFinished, canPass, reduceMotion]);

  // Reanimated keeps driving shared values after unmount unless cancelled.
  useEffect(
    () => () => {
      cancelAnimation(handScaleVal);
      cancelAnimation(giocaPulseVal);
      cancelAnimation(passaPulseVal);
      cancelAnimation(shakeX);
    },
    []
  );

  const handSectionAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: handScaleVal.value }],
  }));
  const giocaAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: giocaPulseVal.value }],
  }));
  const passaAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: passaPulseVal.value }],
  }));
  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));
  const giocaGlowStyle = useAnimatedStyle(() => {
    const v = giocaGlowVal.value;
    if (Platform.OS === "web") {
      return {
        boxShadow:
          v < 0.01
            ? "none"
            : `0 0 ${Math.round(22 * v)}px rgba(201,168,76,${(v * 0.65).toFixed(2)})`,
      } as any;
    }
    return {
      shadowColor: Colors.gold,
      shadowOpacity: v * 0.7,
      shadowRadius: 18 * v,
      shadowOffset: { width: 0, height: 0 },
      elevation: Math.round(14 * v),
    };
  });
  const turnPulseStyle = useTurnPulse(isMyTurn && !isFinished && !exchange.active);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleCardPress = (id: string) => {
    if (!isMyTurn || isFinished) return;
    hapticSelection();
    playCardSelect();
    onSelectCard(id);
  };
  const handlePlay = () => {
    if (!playBtnValid) return;
    hapticMedium();
    playCardPlay();
    onPlay(selectedIds);
  };
  const handlePass = () => {
    if (!canPass) return;
    hapticLight();
    playCardPass();
    onPass();
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const timerActive =
    !!turnTimer &&
    turnTimerActive({
      isMyTurn,
      isFinished,
      isNewRound,
      gameOver: gameState.gameOver,
      exchangeActive: exchange.active,
      includeNewRound: turnTimer.includeNewRound ?? false,
    });

  // Changes on every move and every pass, so the countdown restarts once per
  // turn — including when the same seat leads a new round after winning one.
  const turnToken =
    `${gameState.currentTurnIndex}|${gameState.passCount}|` +
    (gameState.lastPlayedCombination
      ? comboKey(gameState.lastPlayedCombination, gameState.lastPlayedBy)
      : "-");

  const showStartCardBanner = !gameState.firstPlayMade && !!gameState.startCard;
  const dimLabel = playButtonLabel({
    isMyTurn,
    isFinished,
    selectedCount: selectedIds.length,
    comboBuilt: tentativeCombo !== null,
  });

  return (
    <Animated.View style={[styles.root, shakeStyle]}>
      <LinearGradient
        colors={[Colors.bg, "#072A18", Colors.bg]}
        style={StyleSheet.absoluteFill}
      />

      <View
        style={[
          styles.topBar,
          { top: frame.topPad, left: frame.leftPad, right: frame.rightPad },
        ]}
      >
        <Pressable
          onPress={onQuit}
          style={styles.quitBtn}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Abbandona la partita"
        >
          <Ionicons name="close" size={18} color={Colors.textMuted} />
        </Pressable>

        <GameBillboard
          roundLabel={roundLabel}
          currentComboLabel={getComboLabel(pileState.current)}
          currentTurnName={players[gameState.currentTurnIndex]?.name ?? ""}
          isLocalPlayerTurn={isMyTurn && !isFinished}
        />

        <TurnTimer
          seconds={turnTimer?.seconds ?? 0}
          active={timerActive}
          resetKey={turnToken}
          onExpire={turnTimer?.onExpire}
        />

        <View style={styles.topBarRight}>
          <View style={styles.cardCountBadge}>
            <Text style={styles.cardCountText}>{viewer?.hand.length ?? 0}</Text>
          </View>
          {topBarExtra}
        </View>
      </View>

      {banners}

      {/* Felt — clipped to its rounded corners, decoration only */}
      <View
        style={[
          sharedTableStyles.tableBg,
          {
            left: frame.tableLeft,
            top: frame.tableTop,
            right: frame.tableRight,
            bottom: frame.tableBottom,
          },
        ]}
      >
        <LinearGradient
          colors={["#0F5A35", "#0D4A2E", Colors.felt, Colors.feltDark, "#061E12"]}
          locations={[0, 0.25, 0.5, 0.75, 1]}
          style={StyleSheet.absoluteFill}
        />
        <TableVignette />
        <View style={sharedTableStyles.tableInnerBorder} />
      </View>

      {/* Same coordinates, overflow visible so slots and buttons can extend out */}
      <View
        testID="game-table"
        style={[
          sharedTableStyles.tableOverlay,
          {
            left: frame.tableLeft,
            top: frame.tableTop,
            right: frame.tableRight,
            bottom: frame.tableBottom,
          },
        ]}
      >
        <View style={sharedTableStyles.tableContent}>
          <View style={[sharedTableStyles.topSection, { height: TOP_SECTION_H }]}>
            {opponents.top ? (
              <TopOppSlot
                player={opponents.top.player}
                isActive={opponents.top.seat === gameState.currentTurnIndex}
                cardCount={handCountOf(opponents.top.player)}
              />
            ) : (
              <View />
            )}
          </View>

          <View style={sharedTableStyles.midSection}>
            <View style={sharedTableStyles.sideSection}>
              {opponents.left && (
                <SideOppSlot
                  player={opponents.left.player}
                  isActive={opponents.left.seat === gameState.currentTurnIndex}
                  side="left"
                  cardCount={handCountOf(opponents.left.player)}
                />
              )}
            </View>

            <View style={sharedTableStyles.centerSection}>
              {showStartCardBanner ? (
                <View style={styles.startCardBanner}>
                  <Text style={styles.startCardGlyph}>♠</Text>
                  <Text style={styles.startCardText}>
                    {startCardBannerText({
                      card: gameState.startCard!,
                      starterName: players[gameState.currentTurnIndex]?.name ?? "",
                      viewerIsStarter: gameState.currentTurnIndex === viewerSeat,
                    })}
                  </Text>
                </View>
              ) : (
                <PlayedPile
                  prev={pileState.prev}
                  current={flyInfo ? null : pileState.current}
                  roundWinner={roundWinner}
                  bounceTrigger={pileBounceTrigger}
                />
              )}
            </View>

            <View style={sharedTableStyles.sideSection}>
              {opponents.right && (
                <SideOppSlot
                  player={opponents.right.player}
                  isActive={opponents.right.seat === gameState.currentTurnIndex}
                  side="right"
                  cardCount={handCountOf(opponents.right.player)}
                />
              )}
            </View>
          </View>

          <Animated.View
            style={[
              sharedTableStyles.handSection,
              isMyTurn && !isFinished && sharedTableStyles.handSectionActive,
              { height: HAND_SECTION_H },
              handSectionAnimStyle,
              turnPulseStyle,
            ]}
          >
            <Animated.View
              style={[styles.passBtn, !canPass && styles.passBtnDim, passaAnimStyle]}
            >
              <Pressable
                testID="btn-passa"
                onPress={handlePass}
                disabled={!canPass}
                style={styles.passBtnInner}
                accessibilityRole="button"
                accessibilityLabel="Passa il turno"
                accessibilityState={{ disabled: !canPass }}
              >
                <Text
                  style={[styles.passBtnLabel, !canPass && styles.passBtnLabelDim]}
                >
                  PASSA
                </Text>
              </Pressable>
            </Animated.View>

            {isFinished ? (
              <View style={styles.finishedRow}>
                <Ionicons name="trophy" size={18} color={Colors.gold} />
                <Text style={styles.finishedText}>Hai finito! Aspetti gli altri...</Text>
              </View>
            ) : (
              <StraightHand
                cards={sortedHand}
                selectedIds={selectedIds}
                onPress={handleCardPress}
                disabled={!isMyTurn}
                availW={frame.handAvailW}
                isMyTurn={isMyTurn && !isFinished}
              />
            )}

            <Animated.View
              style={[
                styles.playBtn,
                !playBtnValid && styles.playBtnDim,
                giocaAnimStyle,
                playBtnValid && giocaGlowStyle,
              ]}
            >
              <Pressable
                testID="btn-gioca"
                onPress={playBtnValid ? handlePlay : undefined}
                style={styles.playBtnInner}
                accessibilityRole="button"
                accessibilityLabel={
                  playBtnValid
                    ? "Gioca le carte selezionate"
                    : `Gioca — non disponibile: ${dimLabel.replace("\n", " ").toLowerCase()}`
                }
                accessibilityState={{ disabled: !playBtnValid }}
              >
                {playBtnValid ? (
                  <LinearGradient
                    colors={[Colors.goldLight, Colors.gold, Colors.goldDark]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.playBtnGrad}
                  >
                    <Text style={styles.playBtnLabel}>GIOCA</Text>
                    {selectedIds.length > 1 && (
                      <Text style={styles.playBtnSub}>{selectedIds.length}c</Text>
                    )}
                  </LinearGradient>
                ) : (
                  <View style={[styles.playBtnGrad, styles.playBtnGradDim]}>
                    <Text style={styles.playBtnLabelDim} numberOfLines={2}>
                      {dimLabel}
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
          onDone={() => {
            setFlyInfo(null);
            setPileBounceTrigger((t) => t + 1);
          }}
        />
      )}

      {/* Gated on the exchange announcement so the two banners sequence rather
          than stack on top of each other. */}
      {gameState.startReason && !exchangeAnnouncement?.visible && (
        <StartReasonBanner
          key={`reason-${gameState.startReason.type}-${gameState.startReason.playerIdx}`}
          reason={gameState.startReason}
          players={players}
          topOffset={frame.topPad + TOP_BAR_H + TABLE_M + 8}
        />
      )}

      {exchange.active && exchange.viewerIsWinner && exchange.loser && exchange.winner && (
        <ExchangeModal
          phase={gameState.exchangePhase!}
          winnerHand={exchange.winner.hand}
          loserName={exchange.loser.name}
          winnerName={exchange.winner.name}
          onSelectCard={(cardId) => {
            playCardPlay();
            onExchangeGive(cardId);
          }}
        />
      )}

      {exchangeAnnouncement?.data && (
        <ExchangeAnnouncement
          visible={exchangeAnnouncement.visible}
          winnerName={exchangeAnnouncement.data.winnerName}
          loserName={exchangeAnnouncement.data.loserName}
          bothJokersException={exchangeAnnouncement.data.bothJokersException}
          cardGiven={exchangeAnnouncement.data.cardGiven}
          cardReceived={exchangeAnnouncement.data.cardReceived}
          onDismiss={exchangeAnnouncement.onDismiss}
        />
      )}

      {overlays}

      {W < H && (
        <View style={portraitOverlayStyles.overlay}>
          <View style={portraitOverlayStyles.card}>
            <Ionicons name="phone-landscape-outline" size={56} color={Colors.gold} />
            <Text style={portraitOverlayStyles.title}>Ruota il dispositivo</Text>
            <Text style={portraitOverlayStyles.sub}>
              Il gioco richiede la modalità orizzontale
            </Text>
          </View>
        </View>
      )}
    </Animated.View>
  );
}

// The PASSA button's reds are deliberate table furniture — a muted danger that
// reads against the felt without competing with the gold. They have no token
// because nothing else in the app uses them.
const PASS_BG = "#5C1212";
const PASS_BORDER = "#8B1A1A";
const PASS_LABEL = "#FF8080";

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },

  topBar: {
    position: "absolute",
    height: TOP_BAR_H,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.sm,
    gap: Spacing.sm,
    zIndex: 10,
  },
  topBarRight: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  quitBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center", justifyContent: "center",
  },
  timerNum: {
    fontFamily: "Rajdhani_700Bold", fontSize: FontSize.sm,
    color: Colors.gold, minWidth: 20, textAlign: "right",
  },
  timerUrgent: { color: Colors.red },
  cardCountBadge: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center", justifyContent: "center",
  },
  cardCountText: {
    fontFamily: "Rajdhani_700Bold", fontSize: FontSize.md, color: Colors.gold,
  },

  startCardBanner: {
    alignItems: "center", gap: 6,
    paddingHorizontal: Spacing.md, paddingVertical: 10, borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.35)",
    borderWidth: 1, borderColor: "rgba(201,168,76,0.25)",
  },
  startCardGlyph: { fontSize: 28, color: Colors.text },
  startCardText: {
    fontFamily: "Rajdhani_600SemiBold", fontSize: FontSize.sm,
    color: Colors.text, textAlign: "center", letterSpacing: 0.5,
  },

  finishedRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  finishedText: {
    fontFamily: "Rajdhani_600SemiBold", fontSize: FontSize.sm, color: Colors.gold,
  },

  passBtn: {
    width: SIDE_BTN_W, height: CARD_H, borderRadius: Radius.md,
    backgroundColor: PASS_BG, borderWidth: 2, borderColor: PASS_BORDER,
    marginHorizontal: 3, overflow: "hidden",
  },
  passBtnDim: {
    backgroundColor: "rgba(50,12,12,0.55)", borderColor: "rgba(100,20,20,0.35)",
  },
  passBtnInner: { flex: 1, alignItems: "center", justifyContent: "center" },
  passBtnLabel: {
    fontFamily: "Rajdhani_700Bold", fontSize: FontSize.sm,
    color: PASS_LABEL, letterSpacing: 0.5,
  },
  passBtnLabelDim: { color: "rgba(255,128,128,0.3)" },

  playBtn: {
    width: SIDE_BTN_W + 6, height: CARD_H,
    borderRadius: Radius.md, marginHorizontal: 3,
  },
  playBtnDim: { opacity: 0.55 },
  playBtnInner: { flex: 1 },
  playBtnGrad: {
    flex: 1, alignItems: "center", justifyContent: "center",
    gap: 2, borderRadius: Radius.md, overflow: "hidden",
  },
  playBtnGradDim: {
    backgroundColor: "rgba(40,30,5,0.7)",
    borderWidth: 2, borderColor: "rgba(201,168,76,0.2)", borderRadius: Radius.md,
  },
  playBtnLabel: {
    fontFamily: "Rajdhani_700Bold", fontSize: FontSize.sm,
    color: Colors.bgCard, letterSpacing: 0.5,
  },
  playBtnSub: {
    fontFamily: "Rajdhani_500Medium", fontSize: FontSize.xs,
    color: Colors.bgCard, opacity: 0.7,
  },
  // Solid goldLight, not a 0.4-alpha gold: this is the only text that explains
  // why a move was refused, and at 40% opacity it measured 2.23:1.
  playBtnLabelDim: {
    fontFamily: "Rajdhani_600SemiBold", fontSize: FontSize.sm,
    color: Colors.goldLight, letterSpacing: 0.5, textAlign: "center",
  },
});
