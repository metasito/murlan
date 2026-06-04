import React, { useEffect, useRef, useState, memo, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  useWindowDimensions,
  Alert,
  ScrollView,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  withSequence,
  withRepeat,
  withDelay,
  Easing,
  FadeIn,
  FadeOut,
  SlideInRight,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import * as ScreenOrientation from "expo-screen-orientation";
import { Ionicons } from "@expo/vector-icons";
import { useOnlineGame } from "@/context/OnlineGameContext";
import { useAuth } from "@/context/AuthContext";
import {
  buildCombination,
  canPlay,
  sortHand,
  Card,
  Combination,
  Player,
  type StartReason,
} from "@/lib/gameEngine";
import type { Reaction } from "@/context/OnlineGameContext";
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
  playRoundWin,
  playRoundStart,
  playBomb,
  playGameWin,
  playGameLose,
  playDeal,
  preloadSounds,
  unloadSounds,
} from "@/lib/sounds";
import { Colors } from '@/lib/theme';

const EMOJIS = ["😂", "🔥", "😤", "👏", "😱", "🤡", "💣", "👑"];
const POSITION_MEDALS = ["trophy", "medal", "ribbon", "remove-circle"] as const;
const POSITION_COLORS = [Colors.gold, "#C0C0C0", "#CD7F32", Colors.textMuted];
const POSITION_LABELS = ["1°", "2°", "3°", "4°"];

function FloatingReaction({ reaction }: { reaction: Reaction }) {
  const y = useSharedValue(0);
  const opacity = useSharedValue(1);
  useEffect(() => {
    y.value = withTiming(-80, { duration: 1800 });
    opacity.value = withSequence(
      withTiming(1, { duration: 200 }),
      withTiming(0, { duration: 1600 })
    );
  }, []);
  const aStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
    opacity: opacity.value,
  }));
  const posMap = ["50%", "80%", "20%", "60%"];
  const left = posMap[reaction.fromSeat % posMap.length];
  return (
    <Animated.View
      style={[localStyles.floatingEmoji, { left: left as any }, aStyle]}
    >
      <Text style={localStyles.floatingEmojiText}>{reaction.emoji}</Text>
      <Text style={localStyles.floatingEmojiName}>{reaction.username}</Text>
    </Animated.View>
  );
}

function ReactionPanel({
  onSelect,
  onClose,
}: {
  onSelect: (e: string) => void;
  onClose: () => void;
}) {
  return (
    <Animated.View
      entering={SlideInRight.duration(200)}
      style={localStyles.reactionPanel}
    >
      {EMOJIS.map((e) => (
        <Pressable
          key={e}
          onPress={() => {
            onSelect(e);
            onClose();
          }}
          style={({ pressed }) => [
            localStyles.emojiBtn,
            pressed && { opacity: 0.6 },
          ]}
        >
          <Text style={localStyles.emojiBtnText}>{e}</Text>
        </Pressable>
      ))}
    </Animated.View>
  );
}

function RankCard({
  rank,
  name,
  isWinner,
  delay,
  cumPts,
}: {
  rank: number;
  name: string;
  isWinner: boolean;
  delay: number;
  cumPts?: number;
}) {
  const opacity = useSharedValue(0);
  const tx = useSharedValue(40);
  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 350 }));
    tx.value = withDelay(delay, withSpring(0, { damping: 15, stiffness: 200 }));
  }, []);
  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: tx.value }],
  }));
  const color = POSITION_COLORS[rank] ?? Colors.textMuted;
  const icon = POSITION_MEDALS[rank] ?? "person";
  const label = POSITION_LABELS[rank] ?? `${rank + 1}°`;

  return (
    <Animated.View
      style={[goStyles.rankCard, isWinner && goStyles.rankCardWinner, animStyle]}
    >
      {isWinner && (
        <LinearGradient
          colors={["rgba(201,168,76,0.15)", "transparent"]}
          style={StyleSheet.absoluteFill}
        />
      )}
      <View style={[goStyles.positionBadge, { borderColor: color }]}>
        <Text style={[goStyles.positionLabel, { color }]}>{label}</Text>
      </View>
      <Ionicons
        name={icon as React.ComponentProps<typeof Ionicons>["name"]}
        size={16}
        color={color}
      />
      <Text style={goStyles.playerName} numberOfLines={1}>
        {name}
      </Text>
      {cumPts !== undefined && cumPts > 0 && (
        <View style={goStyles.cumScore}>
          <Text style={goStyles.cumScoreText}>{cumPts}pt</Text>
        </View>
      )}
    </Animated.View>
  );
}

function GameOverOverlay({
  gameState,
  topPad,
  bottomPad,
  onLeave,
  onVoteRematch,
  voteState,
  myUserId,
  cumulativeScores,
}: {
  gameState: NonNullable<ReturnType<typeof useOnlineGame>["gameState"]>;
  topPad: number;
  bottomPad: number;
  onLeave: () => void;
  onVoteRematch: () => void;
  voteState: { votes: string[]; total: number } | null;
  myUserId: string;
  cumulativeScores: Record<string, number>;
}) {
  const winnerName = gameState.rankings[0] ?? "";
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
  }, []);
  const celebStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));
  const glowAnim = useAnimatedStyle(() => ({ opacity: glow.value }));

  const hasVoted = voteState?.votes.includes(myUserId) ?? false;
  const voteCount = voteState?.votes.length ?? 0;
  const voteTotal = voteState?.total ?? gameState.players.length;

  return (
    <Animated.View
      entering={FadeIn.duration(400)}
      style={[
        goStyles.overlay,
        { paddingTop: topPad + 4, paddingBottom: bottomPad + 4 },
      ]}
    >
      <LinearGradient
        colors={[Colors.bg, Colors.bgCard, Colors.bg]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Vertical layout: header | rankings | actions */}
      <View style={goStyles.innerCol}>
        {/* TOP: winner celebration (compact, horizontal) */}
        <Animated.View style={[goStyles.celebRow, celebStyle]}>
          <Animated.View style={[goStyles.celebGlow, glowAnim]} />
          <View style={goStyles.trophyCircle}>
            <LinearGradient
              colors={[Colors.gold, Colors.goldDark]}
              style={goStyles.trophyGradient}
            >
              <Ionicons name="trophy" size={26} color="#0A1F18" />
            </LinearGradient>
          </View>
          <View style={goStyles.celebTextBlock}>
            <Text style={goStyles.winnerName} numberOfLines={1}>
              {winnerName}
            </Text>
            <Text style={goStyles.winnerSubtitle}>VINCITORE · Online</Text>
          </View>
          <View style={goStyles.statPills}>
            <View style={goStyles.statPill}>
              <Ionicons name="people" size={11} color={Colors.gold} />
              <Text style={goStyles.statPillText}>{gameState.players.length}P</Text>
            </View>
            <View style={goStyles.statPill}>
              <Ionicons
                name={gameState.gameMode === "teams" ? "people-circle" : "person-circle"}
                size={11}
                color={Colors.textMuted}
              />
              <Text style={goStyles.statPillText}>
                {gameState.gameMode === "teams" ? "Coppie" : "Libero"}
              </Text>
            </View>
          </View>
        </Animated.View>

        {/* MIDDLE: rankings */}
        <Text style={goStyles.sectionTitle}>CLASSIFICA</Text>
        <ScrollView
          showsVerticalScrollIndicator={false}
          style={goStyles.rankScroll}
          contentContainerStyle={goStyles.rankList}
        >
          {gameState.rankings.map((name, i) => {
            const cumPts = cumulativeScores[name];
            return (
              <RankCard
                key={i}
                rank={i}
                name={name}
                isWinner={i === 0}
                delay={i * 80 + 300}
                cumPts={cumPts}
              />
            );
          })}
        </ScrollView>

        {/* BOTTOM: actions */}
        <View style={goStyles.actions}>
          <Pressable onPress={onLeave} style={goStyles.homeBtn}>
            <Ionicons name="home" size={15} color={Colors.textSecondary} />
            <Text style={goStyles.homeBtnText}>Esci</Text>
          </Pressable>
          <Pressable
            testID="btn-rivincita"
            onPress={hasVoted ? undefined : onVoteRematch}
            style={[goStyles.rematchBtn, hasVoted && goStyles.rematchBtnDim]}
          >
            <LinearGradient
              colors={hasVoted ? [Colors.bgSurface, Colors.bgSurface] : [Colors.gold, Colors.goldDark]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={goStyles.rematchGradient}
            >
              <Ionicons
                name={hasVoted ? "checkmark-circle" : "refresh"}
                size={15}
                color={hasVoted ? Colors.accent : "#0A1F18"}
              />
              <Text
                style={[goStyles.rematchText, hasVoted && { color: Colors.textMuted }]}
                numberOfLines={1}
              >
                {hasVoted
                  ? `${voteCount}/${voteTotal} vogliono giocare`
                  : "Rivincita"}
              </Text>
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

function OnlineGameScreenBase() {
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const { user } = useAuth();
  const {
    room,
    gameState,
    reactions,
    mySeatIndex,
    playerLeft,
    rejoinFailed,
    reconnectNotice,
    error,
    clearError,
    playCards,
    pass,
    giveExchangeCard,
    sendReaction,
    leaveRoom,
    voteRematch,
    entrySource,
    rematchVoteState,
    cumulativeScores,
    exchangeAnnouncing,
    exchangeAnnounceData,
    acknowledgeExchange,
    clearPlayerLeft,
  } = useOnlineGame();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [roundWinner, setRoundWinner] = useState<string | null>(null);
  const [pileState, setPileState] = useState<{ prev: Combination | null; current: Combination | null }>({ prev: null, current: null });
  const [showReactions, setShowReactions] = useState(false);
  const [showGameOver, setShowGameOver] = useState(false);
  const [flyInfo, setFlyInfo] = useState<{
    key: string;
    dir: FlyDirection;
    cards: Card[];
  } | null>(null);

  const prevComboKeyRef = useRef<string>("");
  const prevRoundWinnerRef = useRef<number | null>(null);
  const reactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevMyTurnRef = useRef(false);
  const prevGameOverRef = useRef(false);

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    preloadSounds().then(() => playDeal());
    return () => {
      ScreenOrientation.unlockAsync();
      unloadSounds();
    };
  }, []);

  // Flying card animation + pile state — no race condition
  useEffect(() => {
    if (!gameState) return;
    const combo = gameState.lastPlayedCombination;
    if (combo !== null) {
      const comboKey =
        combo.cards.map((c) => c.id).join(",") + "_" + gameState.lastPlayedBy;
      if (comboKey !== prevComboKeyRef.current) {
        prevComboKeyRef.current = comboKey;
        // Update pile immediately — old current becomes prev
        setPileState((s) => ({ prev: s.current, current: combo }));
        // Play bomb sound for special combos
        if (combo.type === "bomb" || combo.type === "royal_straight") {
          playBomb();
        }
        const playedBy = gameState.lastPlayedBy;
        let dir: FlyDirection;
        if (playedBy === mySeatIndex) {
          dir = "bottom";
        } else {
          const totalOpps = gameState.players.length - 1;
          const steps =
            ((playedBy - mySeatIndex + gameState.players.length) %
              gameState.players.length);
          dir = getOpponentPosition(steps, totalOpps);
        }
        setFlyInfo({ key: comboKey, dir, cards: combo.cards });
      }
    } else {
      if (prevComboKeyRef.current !== "") {
        playRoundStart();
      }
      prevComboKeyRef.current = "";
      setPileState({ prev: null, current: null });
      setFlyInfo(null);
    }
  }, [gameState?.lastPlayedCombination]);

  useEffect(() => {
    if (
      gameState?.roundWinner !== null &&
      gameState?.roundWinner !== undefined
    ) {
      if (gameState.roundWinner !== prevRoundWinnerRef.current) {
        prevRoundWinnerRef.current = gameState.roundWinner;
        const name = gameState.players[gameState.roundWinner]?.name ?? "";
        setRoundWinner(name);
        playRoundWin();
        const t = setTimeout(() => setRoundWinner(null), 1800);
        return () => clearTimeout(t);
      }
    }
  }, [gameState?.roundWinner, gameState?.lastPlayedCombination]);

  useEffect(() => {
    if (gameState?.gameOver) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const t = setTimeout(() => setShowGameOver(true), 800);
      return () => clearTimeout(t);
    } else {
      setShowGameOver(false);
    }
  }, [gameState?.gameOver]);

  // Sound: game over (win or lose based on seat position in rankings)
  useEffect(() => {
    if (!gameState?.gameOver || prevGameOverRef.current) return;
    prevGameOverRef.current = true;
    const myName = gameState.players[mySeatIndex]?.name;
    if (myName) {
      const myRank = gameState.rankings.indexOf(myName);
      if (myRank === 0) {
        playGameWin();
      } else if (myRank === gameState.rankings.length - 1) {
        playGameLose();
      }
    }
  }, [gameState?.gameOver]);

  // Sound: your turn notification
  useEffect(() => {
    if (!gameState) return;
    const isMyTurnNow = gameState.currentTurnIndex === mySeatIndex;
    const me = gameState.players[mySeatIndex];
    const finished = me?.finishPosition !== undefined;
    if (isMyTurnNow && !finished && !prevMyTurnRef.current) {
      playYourTurn();
    }
    prevMyTurnRef.current = isMyTurnNow;
  }, [gameState?.currentTurnIndex]);

  // Handle other player leaving — navigate remaining player back to lobby
  useEffect(() => {
    if (!playerLeft) return;
    Alert.alert(
      "Partita interrotta",
      "Un giocatore ha abbandonato la partita.",
      [
        {
          text: "Torna alla lobby",
          onPress: () => {
            clearPlayerLeft();
            leaveRoom();
            if (entrySource === "quickmatch") {
              router.replace("/(online)/quickmatch");
            } else {
              router.replace("/(online)");
            }
          },
        },
      ],
      { cancelable: false }
    );
  }, [playerLeft]);

  useEffect(() => {
    if (!rejoinFailed) return;
    leaveRoom();
    if (entrySource === "quickmatch") {
      router.replace("/(online)/quickmatch");
    } else {
      router.replace("/(online)");
    }
  }, [rejoinFailed]);

  // Auto-clear in-game errors after 3s
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 3000);
    return () => clearTimeout(t);
  }, [error]);

  // Derive game-state-dependent values (safe to read before hooks — they guard with ?.optional)
  const me = gameState?.players[mySeatIndex];
  const isMyTurn = gameState ? gameState.currentTurnIndex === mySeatIndex : false;
  const isNewRound = gameState ? gameState.lastPlayedCombination === null : false;
  const isFinished = me?.finishPosition !== undefined;

  const exchangeActive = gameState?.exchangePhase?.active === true;
  const isMyExchangeWinner =
    exchangeActive && gameState!.exchangePhase!.winnerIdx === mySeatIndex;
  const exchangeLoserPlayer = exchangeActive
    ? gameState!.players[gameState!.exchangePhase!.loserIdx]
    : null;
  const exchangeWinnerPlayer = exchangeActive
    ? gameState!.players[gameState!.exchangePhase!.winnerIdx]
    : null;
  const isMyExchangeLoser =
    exchangeActive && gameState!.exchangePhase!.loserIdx === mySeatIndex;

  // useTurnPulse must be called unconditionally (before any early return)
  const turnPulseStyle = useTurnPulse(!!gameState && isMyTurn && !isFinished && !exchangeActive);

  if (!gameState) return null;

  const sortedHand = useMemo(() => sortHand(me?.hand ?? []), [me?.hand]);
  const selectedObjs = useMemo(
    () => sortedHand.filter((c) => selectedIds.includes(c.id)),
    [sortedHand, selectedIds]
  );
  const tentativeCombo = useMemo(
    () => (selectedObjs.length > 0 ? buildCombination(selectedObjs) : null),
    [selectedObjs]
  );
  const requiresStartCard = !gameState.firstPlayMade && !!gameState.startCard;
  const isValidPlay = useMemo(
    () =>
      tentativeCombo !== null &&
      canPlay(
        tentativeCombo,
        isNewRound ? null : gameState.lastPlayedCombination
      ) &&
      (!requiresStartCard ||
        tentativeCombo.cards.some((c) => c.id === (gameState.startCard as Card).id)),
    [tentativeCombo, isNewRound, gameState.lastPlayedCombination, gameState.startCard, requiresStartCard]
  );
  const canPassNow = !isNewRound && isMyTurn && !isFinished;
  const playBtnValid = isValidPlay && isMyTurn && !isFinished;

  const totalOpponents = gameState.players.length - 1;
  const opponents = useMemo(
    () =>
      gameState.players
        .map((p, i) => ({
          ...p,
          idx: i,
          handCount: (p as any).handCount ?? p.hand.length,
        }))
        .filter((_, i) => i !== mySeatIndex),
    [gameState.players, mySeatIndex]
  );

  const topOpp = useMemo(() => opponents.find(({ idx }) => {
    const steps =
      ((idx - mySeatIndex + gameState.players.length) %
        gameState.players.length);
    return getOpponentPosition(steps, totalOpponents) === "top";
  }), [opponents, mySeatIndex, gameState.players.length, totalOpponents]);

  const leftOpp = useMemo(() => opponents.find(({ idx }) => {
    const steps =
      ((idx - mySeatIndex + gameState.players.length) %
        gameState.players.length);
    return getOpponentPosition(steps, totalOpponents) === "left";
  }), [opponents, mySeatIndex, gameState.players.length, totalOpponents]);

  const rightOpp = useMemo(() => opponents.find(({ idx }) => {
    const steps =
      ((idx - mySeatIndex + gameState.players.length) %
        gameState.players.length);
    return getOpponentPosition(steps, totalOpponents) === "right";
  }), [opponents, mySeatIndex, gameState.players.length, totalOpponents]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const leftPad = Platform.OS === "web" ? 0 : insets.left;
  const rightPad = Platform.OS === "web" ? 0 : insets.right;

  const tableLeft = leftPad + TABLE_M;
  const tableTop = topPad + TOP_BAR_H + TABLE_M;
  const tableRight = rightPad + TABLE_M;
  const tableBottom = bottomPad + TABLE_M;
  const handAvailW =
    W - tableLeft - tableRight - (SIDE_BTN_W + 8) * 2 - 8;

  function toggleCard(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
    Haptics.selectionAsync();
    playCardSelect();
  }

  function handlePlay() {
    if (!playBtnValid) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    playCardPlay();
    playCards(selectedIds);
    setSelectedIds([]);
  }

  function handlePass() {
    if (!canPassNow) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    playCardPass();
    pass();
    setSelectedIds([]);
  }

  function handleReaction(emoji: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    sendReaction(emoji);
  }

  function handleReactionBtnPress() {
    setShowReactions((v) => !v);
    if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);
    if (!showReactions) {
      reactionTimerRef.current = setTimeout(() => setShowReactions(false), 4000);
    }
  }

  function handleExit() {
    Alert.alert(
      "Lascia la partita",
      "Sei sicuro di voler lasciare la partita in corso?",
      [
        { text: "Annulla", style: "cancel" },
        {
          text: "Lascia",
          style: "destructive",
          onPress: () => {
            leaveRoom();
            if (entrySource === "quickmatch") {
              router.replace("/(online)/quickmatch");
            } else {
              router.replace("/(online)");
            }
          },
        },
      ]
    );
  }

  return (
    <View style={localStyles.root}>
      <LinearGradient
        colors={["#031008", "#072A18", "#031008"]}
        style={StyleSheet.absoluteFill}
      />

      {reactions.map((r) => (
        <FloatingReaction key={r.id} reaction={r} />
      ))}

      <View
        style={[
          localStyles.topBar,
          { top: topPad, left: leftPad, right: rightPad },
        ]}
      >
        <Pressable
          onPress={handleExit}
          style={localStyles.exitBtn}
          hitSlop={8}
        >
          <Ionicons name="close" size={18} color={Colors.textMuted} />
        </Pressable>

        <GameBillboard
          roundLabel="Online"
          currentComboLabel={getComboLabel(pileState.current)}
          currentTurnName={gameState.players[gameState.currentTurnIndex]?.name ?? ""}
          isLocalPlayerTurn={isMyTurn && !isFinished}
        />

        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <View style={localStyles.cardCountBadge}>
            <Text style={localStyles.cardCountText}>{me?.hand.length ?? 0}</Text>
          </View>
          <Pressable
            onPress={handleReactionBtnPress}
            style={localStyles.reactionTrigger}
            hitSlop={8}
          >
            <Text style={localStyles.reactionTriggerText}>💬</Text>
          </Pressable>
        </View>
      </View>

      {showReactions && (
        <ReactionPanel
          onSelect={handleReaction}
          onClose={() => setShowReactions(false)}
        />
      )}

      {reconnectNotice && (
        <View style={localStyles.reconnectBanner}>
          <Ionicons name="wifi" size={14} color="#FFD700" />
          <Text style={localStyles.reconnectBannerText} numberOfLines={1}>{reconnectNotice}</Text>
        </View>
      )}

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

      {/* Table overlay — same coords, overflow visible so elements can extend outside */}
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
                player={topOpp}
                isActive={topOpp.idx === gameState.currentTurnIndex}
                cardCount={topOpp.handCount}
              />
            ) : (
              <View />
            )}
          </View>

          <View style={sharedTableStyles.midSection}>
            <View style={sharedTableStyles.sideSection}>
              {leftOpp && (
                <SideOppSlot
                  player={leftOpp}
                  isActive={leftOpp.idx === gameState.currentTurnIndex}
                  side="left"
                  cardCount={leftOpp.handCount}
                />
              )}
            </View>

            <View style={sharedTableStyles.centerSection}>
              <PlayedPile
                prev={pileState.prev}
                current={flyInfo ? null : pileState.current}
                roundWinner={roundWinner}
              />
            </View>

            <View style={sharedTableStyles.sideSection}>
              {rightOpp && (
                <SideOppSlot
                  player={rightOpp}
                  isActive={rightOpp.idx === gameState.currentTurnIndex}
                  side="right"
                  cardCount={rightOpp.handCount}
                />
              )}
            </View>
          </View>

          <Animated.View style={[
            sharedTableStyles.handSection,
            isMyTurn && !isFinished && sharedTableStyles.handSectionActive,
            { height: HAND_SECTION_H },
            turnPulseStyle,
          ]}>
            {/* PASSA — left side */}
            <Pressable
              testID="btn-passa"
              onPress={handlePass}
              disabled={!canPassNow}
              style={[localStyles.passBtn, !canPassNow && localStyles.passBtnDim]}
            >
              <Text style={[localStyles.passBtnLabel, !canPassNow && localStyles.passBtnLabelDim]}>
                PASSA
              </Text>
            </Pressable>

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
                selectedIds={selectedIds}
                onPress={toggleCard}
                disabled={!isMyTurn}
                availW={handAvailW}
                isMyTurn={isMyTurn && !isFinished}
              />
            )}

            {/* GIOCA — right side */}
            <Pressable
              testID="btn-gioca"
              onPress={playBtnValid ? handlePlay : undefined}
              style={[localStyles.playBtn, !playBtnValid && localStyles.playBtnDim]}
            >
              {playBtnValid ? (
                <LinearGradient
                  colors={[Colors.goldLight, Colors.gold, Colors.goldDark]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={localStyles.playBtnGrad}
                >
                  <Text style={localStyles.playBtnLabel}>GIOCA</Text>
                  {selectedIds.length > 1 && (
                    <Text style={localStyles.playBtnSub}>
                      {selectedIds.length}c
                    </Text>
                  )}
                </LinearGradient>
              ) : (
                <View style={[localStyles.playBtnGrad, localStyles.playBtnGradDim]}>
                  <Text style={localStyles.playBtnLabelDim}>GIOCA</Text>
                </View>
              )}
            </Pressable>
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

      {/* Start reason banner — shown at round start; gated on !exchangeAnnouncing so it sequences after exchange announcement */}
      {gameState.startReason && !exchangeAnnouncing && (
        <StartReasonBanner
          key={`reason-${gameState.startReason.type}-${gameState.startReason.playerIdx}`}
          reason={gameState.startReason}
          players={gameState.players}
          topOffset={topPad + TOP_BAR_H + TABLE_M + 8}
        />
      )}

      {/* Exchange: my turn to give a card to the loser */}
      {isMyExchangeWinner && exchangeLoserPlayer && (
        <ExchangeModal
          phase={gameState.exchangePhase!}
          winnerHand={me?.hand ?? []}
          loserName={exchangeLoserPlayer.name}
          winnerName={me?.name ?? ""}
          onSelectCard={(cardId) => {
            playCardPlay();
            giveExchangeCard(cardId);
          }}
        />
      )}

      {/* Exchange: waiting for the winner to send their card */}
      {exchangeActive && !isMyExchangeWinner && (
        <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(3,16,8,0.88)", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <View style={{ backgroundColor: "#0B2A1A", borderRadius: 20, borderWidth: 2, borderColor: "rgba(201,168,76,0.3)", padding: 28, alignItems: "center", gap: 12, maxWidth: 380, width: "80%" }}>
            <Text style={{ fontSize: 32 }}>🔄</Text>
            <Text style={{ fontFamily: "Rajdhani_700Bold", fontSize: 18, color: Colors.gold, letterSpacing: 1, textAlign: "center" }}>
              Scambio in corso...
            </Text>
            {isMyExchangeLoser ? (
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.text, textAlign: "center", lineHeight: 20 }}>
                {exchangeWinnerPlayer?.name ?? "Il vincitore"} sta scegliendo la carta da darti.
              </Text>
            ) : (
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.text, textAlign: "center", lineHeight: 20 }}>
                {exchangeWinnerPlayer?.name ?? "Il vincitore"} sta scegliendo la carta per {exchangeLoserPlayer?.name ?? "il perdente"}.
              </Text>
            )}
          </View>
        </View>
      )}

      {/* In-game error toast — auto-clears after 3s */}
      {error && (
        <View style={localStyles.gameErrorToast}>
          <Ionicons name="alert-circle" size={15} color="#fff" />
          <Text style={localStyles.gameErrorText}>{error}</Text>
        </View>
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

      {showGameOver && gameState.gameOver && (
        <GameOverOverlay
          gameState={gameState}
          topPad={topPad}
          bottomPad={bottomPad}
          onLeave={() => {
            leaveRoom();
            if (entrySource === "quickmatch") {
              router.replace("/(online)/quickmatch");
            } else {
              router.replace("/(online)");
            }
          }}
          onVoteRematch={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            voteRematch();
          }}
          voteState={rematchVoteState}
          myUserId={user?.id ?? ""}
          cumulativeScores={cumulativeScores}
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
  root: { flex: 1, backgroundColor: "#031008" },

  topBar: {
    position: "absolute",
    height: TOP_BAR_H,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    gap: 8,
    zIndex: 10,
  },
  onlineIndicator: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  onlineLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 10,
    color: Colors.textMuted,
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
  cardCountBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  cardCountText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 14,
    color: Colors.gold,
  },
  reactionTrigger: { padding: 6 },
  reactionTriggerText: { fontSize: 20 },
  exitBtn: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  reactionPanel: {
    position: "absolute",
    right: 12,
    top: 52,
    backgroundColor: Colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 8,
    gap: 4,
    width: 180,
    zIndex: 100,
  },
  emojiBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  emojiBtnText: { fontSize: 22 },
  floatingEmoji: {
    position: "absolute",
    bottom: "35%",
    alignItems: "center",
    zIndex: 200,
  },
  floatingEmojiText: { fontSize: 36 },
  floatingEmojiName: {
    fontFamily: "Inter_400Regular",
    fontSize: 10,
    color: Colors.textMuted,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },

  finishedRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  finishedText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 13,
    color: Colors.gold,
  },

  passBtn: {
    width: SIDE_BTN_W,
    height: CARD_H,
    borderRadius: 12,
    backgroundColor: "#5C1212",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#8B1A1A",
    marginHorizontal: 3,
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

  playBtn: {
    width: SIDE_BTN_W + 6,
    height: CARD_H,
    borderRadius: 12,
    overflow: "hidden",
    marginHorizontal: 3,
  },
  playBtnDim: { opacity: 0.55 },
  playBtnGrad: { flex: 1, alignItems: "center", justifyContent: "center", gap: 1 },
  playBtnGradDim: {
    backgroundColor: "rgba(40,30,5,0.7)",
    borderWidth: 2,
    borderColor: "rgba(201,168,76,0.2)",
    borderRadius: 12,
    flex: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
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

  reconnectBanner: {
    position: "absolute",
    top: 2,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.75)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 5,
    zIndex: 50,
  },
  reconnectBannerText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: "#FFD700",
  },

  gameErrorToast: {
    position: "absolute",
    bottom: 100,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(200,50,50,0.92)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    zIndex: 300,
    maxWidth: 340,
  },
  gameErrorText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: "#fff",
    flexShrink: 1,
  },
});

const goStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 300,
    paddingHorizontal: 20,
  },

  innerCol: {
    flex: 1,
    flexDirection: "column",
    gap: 6,
  },

  /* Winner celebration — compact horizontal strip */
  celebRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(201,168,76,0.06)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(201,168,76,0.25)",
    paddingVertical: 8,
    paddingHorizontal: 12,
    position: "relative",
    overflow: "hidden",
  },
  celebGlow: {
    position: "absolute",
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: Colors.gold,
    opacity: 0.08,
    left: -20,
    top: -30,
  },
  trophyCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: Colors.gold,
    flexShrink: 0,
  },
  trophyGradient: { flex: 1, alignItems: "center", justifyContent: "center" },
  celebTextBlock: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  winnerName: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 18,
    color: Colors.text,
    letterSpacing: 1,
  },
  winnerSubtitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 9,
    color: Colors.gold,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  statPills: {
    flexDirection: "row",
    gap: 5,
    flexShrink: 0,
  },
  statPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: Colors.bgSurface,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statPillText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 10,
    color: Colors.textMuted,
  },

  sectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 9,
    color: Colors.textMuted,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  rankScroll: { flex: 1 },
  rankList: { gap: 4, paddingBottom: 2 },
  rankCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.bgSurface,
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  rankCardWinner: { borderColor: Colors.gold },
  positionBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  positionLabel: { fontFamily: "Rajdhani_700Bold", fontSize: 10 },
  playerName: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 13,
    color: Colors.text,
    flex: 1,
  },
  cumScore: {
    backgroundColor: "rgba(201,168,76,0.15)",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: Colors.goldDark,
    flexShrink: 0,
  },
  cumScoreText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 11,
    color: Colors.gold,
  },

  actions: {
    flexDirection: "row",
    gap: 8,
  },
  homeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: Colors.bgSurface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  homeBtnText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 13,
    color: Colors.textSecondary,
  },
  rematchBtn: { flex: 1, borderRadius: 12, overflow: "hidden" },
  rematchBtnDim: { opacity: 0.6 },
  rematchGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  rematchText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 13,
    color: "#0A1F18",
    letterSpacing: 0.5,
    flexShrink: 1,
  },
});

export default memo(OnlineGameScreenBase);
