import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
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
} from "@/lib/gameEngine";
import type { Reaction } from "@/context/OnlineGameContext";
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
import Colors from "@/constants/colors";

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
}: {
  rank: number;
  name: string;
  isWinner: boolean;
  delay: number;
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
        size={18}
        color={color}
      />
      <Text style={goStyles.playerName} numberOfLines={1}>
        {name}
      </Text>
      {isWinner && (
        <View style={goStyles.winnerBadge}>
          <Text style={goStyles.winnerBadgeText}>VINCITORE</Text>
        </View>
      )}
    </Animated.View>
  );
}

function GameOverOverlay({
  gameState,
  topPad,
  bottomPad,
  isHost,
  onLeave,
  onRematch,
}: {
  gameState: NonNullable<ReturnType<typeof useOnlineGame>["gameState"]>;
  topPad: number;
  bottomPad: number;
  isHost: boolean;
  onLeave: () => void;
  onRematch: () => void;
}) {
  const winnerName = gameState.rankings[0] ?? "";
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);
  useEffect(() => {
    scale.value = withSpring(1, { damping: 9, stiffness: 140 });
    opacity.value = withTiming(1, { duration: 500 });
  }, []);
  const celebStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      entering={FadeIn.duration(400)}
      style={[
        goStyles.overlay,
        { paddingTop: topPad + 8, paddingBottom: bottomPad + 8 },
      ]}
    >
      <View style={goStyles.twoCol}>
        <View style={goStyles.leftCol}>
          <Animated.View style={[goStyles.celebration, celebStyle]}>
            <View style={goStyles.trophyCircle}>
              <LinearGradient
                colors={[Colors.gold, Colors.goldDark]}
                style={goStyles.trophyGradient}
              >
                <Ionicons name="trophy" size={32} color="#0A1F18" />
              </LinearGradient>
            </View>
            <Text style={goStyles.winnerName} numberOfLines={1}>
              {winnerName}
            </Text>
            <Text style={goStyles.winnerSubtitle}>Vincitore</Text>
          </Animated.View>

          <View style={goStyles.actions}>
            <Pressable onPress={onLeave} style={goStyles.homeBtn}>
              <Ionicons name="home" size={16} color={Colors.textSecondary} />
              <Text style={goStyles.homeBtnText}>Home</Text>
            </Pressable>
            <Pressable
              testID="btn-rivincita"
              onPress={isHost ? onRematch : undefined}
              style={[goStyles.rematchBtn, !isHost && goStyles.rematchBtnDim]}
            >
              <LinearGradient
                colors={
                  isHost
                    ? [Colors.gold, Colors.goldDark]
                    : [Colors.bgSurface, Colors.bgSurface]
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={goStyles.rematchGradient}
              >
                <Ionicons
                  name="refresh"
                  size={16}
                  color={isHost ? "#0A1F18" : Colors.textMuted}
                />
                <Text
                  style={[
                    goStyles.rematchText,
                    !isHost && { color: Colors.textMuted },
                  ]}
                  numberOfLines={1}
                >
                  {isHost ? "Rivincita" : "Solo l'host può riavviare"}
                </Text>
              </LinearGradient>
            </Pressable>
          </View>
        </View>

        <View style={goStyles.rightCol}>
          <Text style={goStyles.sectionTitle}>CLASSIFICA</Text>
          <View style={goStyles.rankList}>
            {gameState.rankings.map((name, i) => (
              <RankCard
                key={i}
                rank={i}
                name={name}
                isWinner={i === 0}
                delay={i * 80 + 300}
              />
            ))}
          </View>

          <Text style={[goStyles.sectionTitle, { marginTop: 10 }]}>
            RIEPILOGO
          </Text>
          <View style={goStyles.statsRow}>
            <View style={goStyles.statItem}>
              <Ionicons name="people" size={16} color={Colors.gold} />
              <Text style={goStyles.statValue}>{gameState.players.length}</Text>
              <Text style={goStyles.statLabel}>Giocatori</Text>
            </View>
            <View style={goStyles.statItem}>
              <Ionicons
                name={
                  gameState.gameMode === "teams"
                    ? "people-circle"
                    : "person-circle"
                }
                size={16}
                color={Colors.gold}
              />
              <Text style={goStyles.statValue}>
                {gameState.gameMode === "teams" ? "Coppie" : "Libero"}
              </Text>
              <Text style={goStyles.statLabel}>Modalità</Text>
            </View>
            <View style={goStyles.statItem}>
              <Ionicons name="wifi" size={16} color={Colors.accent} />
              <Text style={goStyles.statValue}>Online</Text>
              <Text style={goStyles.statLabel}>Modalità</Text>
            </View>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

export default function OnlineGameScreen() {
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const { user } = useAuth();
  const {
    room,
    gameState,
    reactions,
    mySeatIndex,
    playCards,
    pass,
    sendReaction,
    leaveRoom,
    requestPlayAgain,
  } = useOnlineGame();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [roundWinner, setRoundWinner] = useState<string | null>(null);
  const [playedPile, setPlayedPile] = useState<Combination[]>([]);
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
    const combo = gameState.lastPlayedCombination;
    if (combo !== null) {
      const comboKey =
        combo.cards.map((c) => c.id).join(",") + "_" + gameState.lastPlayedBy;
      if (comboKey !== prevComboKeyRef.current) {
        prevComboKeyRef.current = comboKey;
        setPlayedPile((prev) => [...prev.slice(-5), combo]);
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
      prevComboKeyRef.current = "";
      setPlayedPile([]);
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

  if (!gameState) return null;

  const me = gameState.players[mySeatIndex];
  const isMyTurn = gameState.currentTurnIndex === mySeatIndex;
  const isNewRound = gameState.lastPlayedCombination === null;
  const isFinished = me?.finishPosition !== undefined;

  const sortedHand = sortHand(me?.hand ?? []);
  const selectedObjs = sortedHand.filter((c) => selectedIds.includes(c.id));
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
      tentativeCombo.cards.some((c) => c.rank === "3" && c.suit === "spades"));
  const canPassNow = !isNewRound && isMyTurn && !isFinished;
  const playBtnValid = isValidPlay && isMyTurn && !isFinished;

  const totalOpponents = gameState.players.length - 1;
  const opponents = gameState.players
    .map((p, i) => ({
      ...p,
      idx: i,
      handCount: (p as any).handCount ?? p.hand.length,
    }))
    .filter((_, i) => i !== mySeatIndex);

  const topOpp = opponents.find(({ idx }) => {
    const steps =
      ((idx - mySeatIndex + gameState.players.length) %
        gameState.players.length);
    return getOpponentPosition(steps, totalOpponents) === "top";
  });
  const leftOpp = opponents.find(({ idx }) => {
    const steps =
      ((idx - mySeatIndex + gameState.players.length) %
        gameState.players.length);
    return getOpponentPosition(steps, totalOpponents) === "left";
  });
  const rightOpp = opponents.find(({ idx }) => {
    const steps =
      ((idx - mySeatIndex + gameState.players.length) %
        gameState.players.length);
    return getOpponentPosition(steps, totalOpponents) === "right";
  });

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const leftPad = Platform.OS === "web" ? 0 : insets.left;
  const rightPad = Platform.OS === "web" ? 0 : insets.right;

  const tableLeft = leftPad + TABLE_M;
  const tableTop = topPad + TOP_BAR_H + TABLE_M;
  const tableRight = rightPad + TABLE_M;
  const tableBottom = bottomPad + TABLE_M;
  const handAvailW =
    W - tableLeft - tableRight - (BTN_W + 10) * 2;

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

  const isHost = room?.hostUserId === user?.id;

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
        <View style={localStyles.onlineIndicator}>
          <View style={[localStyles.dot, { backgroundColor: "#4CAF50" }]} />
          <Text style={localStyles.onlineLabel}>Online</Text>
        </View>

        <View style={localStyles.turnPill}>
          <View
            style={[
              localStyles.turnDot,
              { backgroundColor: isMyTurn ? Colors.gold : Colors.accent },
            ]}
          />
          <Text style={localStyles.turnText} numberOfLines={1}>
            {isMyTurn
              ? isFinished
                ? "Aspetti gli altri..."
                : "Il tuo turno"
              : `${gameState.players[gameState.currentTurnIndex]?.name} pensa...`}
          </Text>
          <View style={localStyles.cardCountBadge}>
            <Text style={localStyles.cardCountText}>{me?.hand.length ?? 0}</Text>
          </View>
        </View>

        <Pressable
          onPress={handleReactionBtnPress}
          style={localStyles.reactionTrigger}
          hitSlop={8}
        >
          <Text style={localStyles.reactionTriggerText}>💬</Text>
        </Pressable>
      </View>

      {showReactions && (
        <ReactionPanel
          onSelect={handleReaction}
          onClose={() => setShowReactions(false)}
        />
      )}

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
              <PlayedPile history={playedPile} roundWinner={roundWinner} />
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

          <View style={[sharedTableStyles.handSection, { height: HAND_SECTION_H }]}>
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
                selectedIds={selectedIds}
                onPress={toggleCard}
                disabled={!isMyTurn}
                availW={handAvailW}
              />
            )}
          </View>
        </View>
      </View>

      <Pressable
        testID="btn-passa"
        onPress={handlePass}
        disabled={!canPassNow}
        style={[
          localStyles.passBtn,
          { left: leftPad + TABLE_M - 2, bottom: bottomPad + TABLE_M - 2 },
          !canPassNow && localStyles.passBtnDim,
        ]}
      >
        <Text
          style={[
            localStyles.passBtnLabel,
            !canPassNow && localStyles.passBtnLabelDim,
          ]}
        >
          PASSA
        </Text>
      </Pressable>

      <Pressable
        testID="btn-gioca"
        onPress={playBtnValid ? handlePlay : undefined}
        style={[
          localStyles.playBtn,
          { right: rightPad + TABLE_M - 2, bottom: bottomPad + TABLE_M - 2 },
          !playBtnValid && localStyles.playBtnDim,
        ]}
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
                {selectedIds.length} carte
              </Text>
            )}
          </LinearGradient>
        ) : (
          <View style={[localStyles.playBtnGrad, localStyles.playBtnGradDim]}>
            <Text style={localStyles.playBtnLabelDim}>GIOCA</Text>
          </View>
        )}
      </Pressable>

      {flyInfo && (
        <FlyingCards
          key={flyInfo.key}
          cards={flyInfo.cards}
          direction={flyInfo.dir}
          onDone={() => setFlyInfo(null)}
        />
      )}

      {showGameOver && gameState.gameOver && (
        <GameOverOverlay
          gameState={gameState}
          topPad={topPad}
          bottomPad={bottomPad}
          isHost={isHost}
          onLeave={() => {
            leaveRoom();
            router.replace("/(online)");
          }}
          onRematch={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            requestPlayAgain();
          }}
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
  playBtnGrad: { flex: 1, alignItems: "center", justifyContent: "center", gap: 1 },
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

const goStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(6,20,16,0.96)",
    zIndex: 300,
    paddingHorizontal: 16,
  },
  twoCol: {
    flex: 1,
    flexDirection: "row",
    gap: 16,
  },
  leftCol: {
    width: 200,
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  rightCol: {
    flex: 1,
    paddingVertical: 8,
    gap: 6,
  },
  celebration: {
    alignItems: "center",
    gap: 8,
  },
  trophyCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: Colors.gold,
  },
  trophyGradient: { flex: 1, alignItems: "center", justifyContent: "center" },
  winnerName: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 22,
    color: Colors.text,
    letterSpacing: 1,
    maxWidth: 180,
    textAlign: "center",
  },
  winnerSubtitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    color: Colors.gold,
    letterSpacing: 2,
    textTransform: "uppercase",
  },

  sectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 10,
    color: Colors.textMuted,
    letterSpacing: 2,
  },
  rankList: { gap: 6 },
  rankCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: Colors.bgSurface,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  rankCardWinner: { borderColor: Colors.gold },
  positionBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  positionLabel: { fontFamily: "Rajdhani_700Bold", fontSize: 12 },
  playerName: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 14,
    color: Colors.text,
    flex: 1,
  },
  winnerBadge: {
    backgroundColor: Colors.goldMuted,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: Colors.goldDark,
  },
  winnerBadgeText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 9,
    color: Colors.gold,
    letterSpacing: 1,
  },

  statsRow: { flexDirection: "row", gap: 8 },
  statItem: {
    flex: 1,
    backgroundColor: Colors.bgSurface,
    borderRadius: 10,
    padding: 10,
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statValue: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 14,
    color: Colors.text,
  },
  statLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 9,
    color: Colors.textMuted,
  },

  actions: { width: "100%", gap: 8 },
  homeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: Colors.bgSurface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  homeBtnText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 14,
    color: Colors.textSecondary,
  },
  rematchBtn: { borderRadius: 12, overflow: "hidden" },
  rematchBtnDim: { opacity: 0.6 },
  rematchGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  rematchText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 14,
    color: "#0A1F18",
    letterSpacing: 0.5,
    flexShrink: 1,
  },
});
