import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  ScrollView,
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
  runOnJS,
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
import { CardView } from "@/components/CardView";
import { buildCombination, canPlay, sortHand, Card, Combination, Player } from "@/lib/gameEngine";
import type { Reaction } from "@/context/OnlineGameContext";
import Colors from "@/constants/colors";

// ─── Layout constants (mirror offline game) ──────────────────────────────────
const CARD_W = 58;
const CARD_H = 84;
const BTN_W = 84;
const BTN_H = 84;
const TOP_BAR_H = 44;
const TABLE_M = 8;
const SIDE_SECTION_W = 160;
const TOP_SECTION_H = 82;
const HAND_SECTION_H = CARD_H + 14;

const EMOJIS = ["😂", "🔥", "😤", "👏", "😱", "🤡", "💣", "👑"];

const POSITION_MEDALS = ["trophy", "medal", "ribbon", "remove-circle"] as const;
const POSITION_COLORS = [Colors.gold, "#C0C0C0", "#CD7F32", Colors.textMuted];
const POSITION_LABELS = ["1°", "2°", "3°", "4°"];

// ─── Opponent position logic (identical to offline) ───────────────────────────
function getOpponentPosition(steps: number, total: number): "top" | "left" | "right" {
  if (total === 1) return "top";
  if (total === 2) return steps === 1 ? "right" : "top";
  if (steps === 1) return "right";
  if (steps === 2) return "top";
  return "left";
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function CardFan({ count, maxCards = 7 }: { count: number; maxCards?: number }) {
  const n = Math.min(count, maxCards);
  if (n === 0) return null;
  const step = 15;
  const totalW = step * (n - 1) + 40;
  return (
    <View style={{ width: totalW, height: 66 }}>
      {Array.from({ length: n }, (_, i) => {
        const c = (n - 1) / 2;
        const angle = ((i - c) / Math.max(c, 1)) * 22;
        const rise = Math.abs(i - c) * 4;
        return (
          <View
            key={i}
            style={{ position: "absolute", left: i * step, bottom: rise, transform: [{ rotate: `${angle}deg` }], zIndex: i }}
          >
            <CardView card={{ id: `bk${i}`, suit: null, rank: "3", isJoker: false }} faceDown small />
          </View>
        );
      })}
    </View>
  );
}

function AvatarCircle({
  name, isActive, cardCount, finishPos, size = 44,
}: {
  name: string; isActive: boolean; cardCount: number; finishPos?: number; size?: number;
}) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (isActive) {
      pulse.value = withSequence(withTiming(1.1, { duration: 350 }), withTiming(1, { duration: 350 }));
    }
  }, [isActive]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <Animated.View style={anim}>
      <View style={[
        styles.avatarOuter,
        { width: size + 6, height: size + 6, borderRadius: (size + 6) / 2 },
        isActive && styles.avatarOuterActive,
      ]}>
        <View style={[styles.avatarInner, { width: size, height: size, borderRadius: size / 2 }]}>
          <Text style={[styles.avatarInitials, { fontSize: size * 0.36 }]}>{initials}</Text>
        </View>
        <View style={styles.countBubble}>
          {finishPos !== undefined
            ? <Ionicons name="trophy" size={8} color={Colors.gold} />
            : <Text style={styles.countBubbleText}>{cardCount}</Text>
          }
        </View>
      </View>
    </Animated.View>
  );
}

function TopOppSlot({ player, isActive, cardCount }: { player: Player; isActive: boolean; cardCount: number }) {
  return (
    <View style={styles.topOppSlot}>
      <View style={styles.topOppRow}>
        <View style={styles.topOppAvatarCol}>
          <AvatarCircle name={player.name} isActive={isActive} cardCount={cardCount} finishPos={player.finishPosition} size={42} />
          <Text style={styles.oppName} numberOfLines={1}>{player.name}</Text>
        </View>
        {player.finishPosition === undefined && cardCount > 0 && (
          <CardFan count={cardCount} maxCards={7} />
        )}
      </View>
    </View>
  );
}

function SideOppSlot({ player, isActive, side, cardCount }: { player: Player; isActive: boolean; side: "left" | "right"; cardCount: number }) {
  const isLeft = side === "left";
  return (
    <View style={[styles.sideOppSlot, isLeft ? styles.sideLeft : styles.sideRight]}>
      {!isLeft && cardCount > 0 && player.finishPosition === undefined && (
        <CardFan count={cardCount} maxCards={5} />
      )}
      <View style={styles.sideOppAvatarCol}>
        <AvatarCircle name={player.name} isActive={isActive} cardCount={cardCount} finishPos={player.finishPosition} size={40} />
        <Text style={styles.oppName} numberOfLines={1}>{player.name}</Text>
      </View>
      {isLeft && cardCount > 0 && player.finishPosition === undefined && (
        <CardFan count={cardCount} maxCards={5} />
      )}
    </View>
  );
}

type FlyDirection = "top" | "bottom" | "left" | "right";

const FLY_OFFSETS: Record<FlyDirection, { dx: number; dy: number }> = {
  bottom: { dx: 0, dy: 130 },
  top: { dx: 0, dy: -90 },
  left: { dx: -160, dy: 0 },
  right: { dx: 160, dy: 0 },
};
const FLY_ROTS: Record<FlyDirection, number> = { bottom: -8, top: 8, left: -12, right: 12 };

function FlyingCards({ cards, direction, onDone }: { cards: Card[]; direction: FlyDirection; onDone: () => void }) {
  const { dx, dy } = FLY_OFFSETS[direction];
  const tx = useSharedValue(dx);
  const ty = useSharedValue(dy);
  const rot = useSharedValue(FLY_ROTS[direction]);
  const opacity = useSharedValue(0.9);

  useEffect(() => {
    const easing = Easing.out(Easing.cubic);
    tx.value = withTiming(0, { duration: 420, easing });
    ty.value = withTiming(0, { duration: 420, easing });
    rot.value = withTiming(0, { duration: 420, easing });
    opacity.value = withSequence(
      withTiming(1, { duration: 280 }),
      withTiming(0, { duration: 170 }, (finished) => {
        if (finished) runOnJS(onDone)();
      })
    );
  }, []);

  const aStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { rotate: `${rot.value}deg` }],
    opacity: opacity.value,
  }));

  const display = cards.slice(0, 3);

  return (
    <View style={styles.flyingContainer} pointerEvents="none">
      <Animated.View style={[styles.flyingInner, aStyle]}>
        {display.map((card, i) => (
          <View
            key={card.id}
            style={{ position: "absolute", left: i * 12 - (display.length - 1) * 6, zIndex: i, transform: [{ rotate: `${(i - (display.length - 1) / 2) * 10}deg` }] }}
          >
            <CardView card={card} />
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

function PlayedPile({ history, roundWinner }: { history: Combination[]; roundWinner: string | null }) {
  const topCombo = history.length > 0 ? history[history.length - 1] : null;
  return (
    <View style={styles.pileArea} testID="pile-area">
      {roundWinner && (
        <Animated.View entering={FadeIn.duration(250)} exiting={FadeOut.duration(250)} style={styles.winnerTag}>
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
              <View key={`p${si}`} style={[styles.pileLayer, { zIndex: si, opacity: isTop ? 1 : 0.4 + si * 0.15, transform: [{ rotate: `${angle}deg` }, { translateX: dx }, { translateY: dy }] }]}>
                <View style={styles.pileCards}>
                  {combo.cards.slice(0, 5).map((card, ci) => (
                    <View key={card.id} style={{ marginLeft: ci > 0 ? -14 : 0, zIndex: ci }}>
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
                  {({ single: "Singola", pair: "Coppia", triple: "Tris", straight: "Scala", bomb: "💣 Bomba", royal_straight: "★ Scala Reale" } as Record<string, string>)[topCombo.type]}
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

function CardItem({ card, isSelected, left, onPress, disabled, zIndex }: {
  card: Card; isSelected: boolean; left: number; onPress: () => void; disabled: boolean; zIndex: number;
}) {
  const liftY = useSharedValue(0);
  useEffect(() => {
    liftY.value = withSpring(isSelected ? -40 : 0, { damping: 14, stiffness: 260 });
  }, [isSelected]);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ translateY: liftY.value }] }));
  return (
    <Animated.View style={[styles.handCardWrap, { left, zIndex }, aStyle]}>
      <CardView card={card} selected={isSelected} onPress={onPress} disabled={disabled} noLift />
    </Animated.View>
  );
}

function StraightHand({ cards, selectedIds, onPress, disabled, availW }: {
  cards: Card[]; selectedIds: string[]; onPress: (id: string) => void; disabled: boolean; availW: number;
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

function FloatingReaction({ reaction }: { reaction: Reaction }) {
  const y = useSharedValue(0);
  const opacity = useSharedValue(1);
  useEffect(() => {
    y.value = withTiming(-80, { duration: 1800 });
    opacity.value = withSequence(withTiming(1, { duration: 200 }), withTiming(0, { duration: 1600 }));
  }, []);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }], opacity: opacity.value }));
  const posMap = ["50%", "80%", "20%", "60%"];
  const left = posMap[reaction.fromSeat % posMap.length];
  return (
    <Animated.View style={[styles.floatingEmoji, { left: left as any }, aStyle]}>
      <Text style={styles.floatingEmojiText}>{reaction.emoji}</Text>
      <Text style={styles.floatingEmojiName}>{reaction.username}</Text>
    </Animated.View>
  );
}

function ReactionPanel({ onSelect, onClose }: { onSelect: (e: string) => void; onClose: () => void }) {
  return (
    <Animated.View entering={SlideInRight.duration(200)} style={styles.reactionPanel}>
      {EMOJIS.map((e) => (
        <Pressable key={e} onPress={() => { onSelect(e); onClose(); }} style={({ pressed }) => [styles.emojiBtn, pressed && { opacity: 0.6 }]}>
          <Text style={styles.emojiBtnText}>{e}</Text>
        </Pressable>
      ))}
    </Animated.View>
  );
}

// ─── Game Over Result Screen ──────────────────────────────────────────────────

function WinnerCelebration({ name }: { name: string }) {
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);
  const glow = useSharedValue(0.6);

  useEffect(() => {
    scale.value = withSpring(1, { damping: 8, stiffness: 150 });
    opacity.value = withTiming(1, { duration: 600 });
    glow.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.6, { duration: 1200, easing: Easing.inOut(Easing.sin) })
      ),
      -1, false
    );
  }, []);

  const containerStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }], opacity: opacity.value }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  return (
    <Animated.View style={[goStyles.celebration, containerStyle]}>
      <Animated.View style={[goStyles.celebrationGlow, glowStyle]} />
      <View style={goStyles.trophyCircle}>
        <LinearGradient colors={[Colors.gold, Colors.goldDark]} style={goStyles.trophyGradient}>
          <Ionicons name="trophy" size={44} color="#0A1F18" />
        </LinearGradient>
      </View>
      <Text style={goStyles.winnerName}>{name}</Text>
      <Text style={goStyles.winnerSubtitle}>Vincitore</Text>
    </Animated.View>
  );
}

function RankCard({ rank, name, isWinner, delay }: { rank: number; name: string; isWinner: boolean; delay: number }) {
  const opacity = useSharedValue(0);
  const translateX = useSharedValue(60);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 400 }));
    translateX.value = withDelay(delay, withSpring(0, { damping: 15, stiffness: 200 }));
  }, []);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateX: translateX.value }] }));

  const color = POSITION_COLORS[rank] ?? Colors.textMuted;
  const icon = POSITION_MEDALS[rank] ?? "person";
  const label = POSITION_LABELS[rank] ?? `${rank + 1}°`;

  return (
    <Animated.View style={[goStyles.rankCard, isWinner && goStyles.rankCardWinner, animStyle]}>
      {isWinner && <LinearGradient colors={["rgba(201,168,76,0.15)", "transparent"]} style={StyleSheet.absoluteFill} />}
      <View style={[goStyles.positionBadge, { borderColor: color }]}>
        <Text style={[goStyles.positionLabel, { color }]}>{label}</Text>
      </View>
      <Ionicons name={icon as React.ComponentProps<typeof Ionicons>["name"]} size={24} color={color} />
      <Text style={goStyles.playerName}>{name}</Text>
      {isWinner && (
        <View style={goStyles.winnerBadge}>
          <Text style={goStyles.winnerBadgeText}>VINCITORE</Text>
        </View>
      )}
    </Animated.View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function OnlineGameScreen() {
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const { user } = useAuth();
  const {
    room,
    gameState,
    reactions,
    mySeatIndex,
    error,
    clearError,
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
  const [flyInfo, setFlyInfo] = useState<{ key: string; dir: FlyDirection; cards: Card[] } | null>(null);

  // T003: Use string key to avoid duplicate animation on re-broadcast
  const prevComboKeyRef = useRef<string>("");
  const prevRoundWinnerRef = useRef<number | null>(null);
  const reactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    const combo = gameState.lastPlayedCombination;

    if (combo !== null) {
      const comboKey = combo.cards.map((c) => c.id).join(",") + "_" + gameState.lastPlayedBy;
      if (comboKey !== prevComboKeyRef.current) {
        prevComboKeyRef.current = comboKey;
        setPlayedPile((prev) => [...prev.slice(-5), combo]);
        const playedBy = gameState.lastPlayedBy;
        let dir: FlyDirection;
        if (playedBy === mySeatIndex) {
          dir = "bottom";
        } else {
          const totalOpponents = gameState.players.length - 1;
          const steps = ((playedBy - mySeatIndex + gameState.players.length) % gameState.players.length);
          dir = getOpponentPosition(steps, totalOpponents);
        }
        setFlyInfo({ key: comboKey, dir, cards: combo.cards });
      }
    } else {
      prevComboKeyRef.current = "";
      setPlayedPile([]);
    }
  }, [gameState?.lastPlayedCombination]);

  useEffect(() => {
    if (gameState?.roundWinner !== null && gameState?.roundWinner !== undefined) {
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
      // New game started — hide the game over overlay
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
  const tentativeCombo = selectedObjs.length > 0 ? buildCombination(selectedObjs) : null;
  const requires3Spades = !gameState.firstPlayMade;
  const isValidPlay =
    tentativeCombo !== null &&
    canPlay(tentativeCombo, isNewRound ? null : gameState.lastPlayedCombination) &&
    (!requires3Spades || tentativeCombo.cards.some((c) => c.rank === "3" && c.suit === "spades"));
  const canPassNow = !isNewRound && isMyTurn && !isFinished;
  const playBtnValid = isValidPlay && isMyTurn && !isFinished;

  const totalOpponents = gameState.players.length - 1;
  const opponents = gameState.players
    .map((p, i) => ({ ...p, idx: i, handCount: (p as any).handCount ?? p.hand.length }))
    .filter((_, i) => i !== mySeatIndex);

  const topOpp = opponents.find(({ idx }) => {
    const steps = ((idx - mySeatIndex + gameState.players.length) % gameState.players.length);
    return getOpponentPosition(steps, totalOpponents) === "top";
  });
  const leftOpp = opponents.find(({ idx }) => {
    const steps = ((idx - mySeatIndex + gameState.players.length) % gameState.players.length);
    return getOpponentPosition(steps, totalOpponents) === "left";
  });
  const rightOpp = opponents.find(({ idx }) => {
    const steps = ((idx - mySeatIndex + gameState.players.length) % gameState.players.length);
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
  const handAvailW = (W - tableLeft - tableRight) - (BTN_W + 10) * 2;

  function toggleCard(id: string) {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
    Haptics.selectionAsync();
  }

  function handlePlay() {
    if (!playBtnValid) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    playCards(selectedIds);
    setSelectedIds([]);
  }

  function handlePass() {
    if (!canPassNow) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
  const winnerName = gameState.rankings[0] ?? "";

  return (
    <View style={styles.root}>
      <LinearGradient colors={["#031008", "#072A18", "#031008"]} style={StyleSheet.absoluteFill} />

      {reactions.map((r) => (
        <FloatingReaction key={r.id} reaction={r} />
      ))}

      {/* Top bar */}
      <View style={[styles.topBar, { top: topPad, left: leftPad, right: rightPad }]}>
        <View style={styles.onlineIndicator}>
          <View style={[styles.dot, { backgroundColor: "#4CAF50" }]} />
          <Text style={styles.onlineLabel}>Online</Text>
        </View>

        <View style={styles.turnPill}>
          <View style={[styles.turnDot, { backgroundColor: isMyTurn ? Colors.gold : Colors.accent }]} />
          <Text style={styles.turnText} numberOfLines={1}>
            {isMyTurn
              ? isFinished ? "Aspetti gli altri..." : "Il tuo turno"
              : `${gameState.players[gameState.currentTurnIndex]?.name} pensa...`}
          </Text>
          <View style={styles.cardCountBadge}>
            <Text style={styles.cardCountText}>{me?.hand.length ?? 0}</Text>
          </View>
        </View>

        <Pressable onPress={handleReactionBtnPress} style={styles.reactionTrigger} hitSlop={8}>
          <Text style={styles.reactionTriggerText}>💬</Text>
        </Pressable>
      </View>

      {showReactions && (
        <ReactionPanel onSelect={handleReaction} onClose={() => setShowReactions(false)} />
      )}

      {/* Felt table — absolute positioned, identical to offline */}
      <View
        testID="game-table"
        style={[styles.table, { left: tableLeft, top: tableTop, right: tableRight, bottom: tableBottom }]}
      >
        <LinearGradient colors={["#0D4A2E", Colors.felt, "#082B1A"]} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />
        <View style={styles.tableInnerBorder} />

        <View style={styles.tableContent}>
          {/* Top opponent */}
          <View style={[styles.topSection, { height: TOP_SECTION_H }]}>
            {topOpp ? (
              <TopOppSlot player={topOpp} isActive={topOpp.idx === gameState.currentTurnIndex} cardCount={topOpp.handCount} />
            ) : (
              <View />
            )}
          </View>

          {/* Mid: left | pile | right */}
          <View style={styles.midSection}>
            <View style={styles.sideSection}>
              {leftOpp && (
                <SideOppSlot player={leftOpp} isActive={leftOpp.idx === gameState.currentTurnIndex} side="left" cardCount={leftOpp.handCount} />
              )}
            </View>

            <View style={styles.centerSection}>
              <PlayedPile history={playedPile} roundWinner={roundWinner} />
            </View>

            <View style={styles.sideSection}>
              {rightOpp && (
                <SideOppSlot player={rightOpp} isActive={rightOpp.idx === gameState.currentTurnIndex} side="right" cardCount={rightOpp.handCount} />
              )}
            </View>
          </View>

          {/* Hand section */}
          <View style={[styles.handSection, { height: HAND_SECTION_H }]}>
            {isFinished ? (
              <View style={styles.finishedRow}>
                <Ionicons name="trophy" size={18} color={Colors.gold} />
                <Text style={styles.finishedText}>Hai finito! Aspetti gli altri...</Text>
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

      {/* PASSA button */}
      <Pressable
        testID="btn-passa"
        onPress={handlePass}
        disabled={!canPassNow}
        style={[styles.passBtn, { left: leftPad + TABLE_M - 2, bottom: bottomPad + TABLE_M - 2 }, !canPassNow && styles.passBtnDim]}
      >
        <Text style={[styles.passBtnLabel, !canPassNow && styles.passBtnLabelDim]}>PASSA</Text>
      </Pressable>

      {/* GIOCA button */}
      <Pressable
        testID="btn-gioca"
        onPress={playBtnValid ? handlePlay : undefined}
        style={[styles.playBtn, { right: rightPad + TABLE_M - 2, bottom: bottomPad + TABLE_M - 2 }, !playBtnValid && styles.playBtnDim]}
      >
        {playBtnValid ? (
          <LinearGradient colors={[Colors.goldLight, Colors.gold, Colors.goldDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.playBtnGrad}>
            <Text style={styles.playBtnLabel}>GIOCA</Text>
            {selectedIds.length > 1 && <Text style={styles.playBtnSub}>{selectedIds.length} carte</Text>}
          </LinearGradient>
        ) : (
          <View style={[styles.playBtnGrad, styles.playBtnGradDim]}>
            <Text style={styles.playBtnLabelDim}>GIOCA</Text>
          </View>
        )}
      </Pressable>

      {/* Card throw animation */}
      {flyInfo && (
        <FlyingCards key={flyInfo.key} cards={flyInfo.cards} direction={flyInfo.dir} onDone={() => setFlyInfo(null)} />
      )}

      {/* Full-screen game over result */}
      {showGameOver && gameState.gameOver && (
        <Animated.View entering={FadeIn.duration(400)} style={goStyles.overlay}>
          <ScrollView
            contentContainerStyle={[goStyles.scroll, { paddingTop: topPad + 16, paddingBottom: bottomPad + 16 }]}
            showsVerticalScrollIndicator={false}
          >
            <Text style={goStyles.title}>Partita Finita</Text>

            <WinnerCelebration name={winnerName} />

            <View style={goStyles.section}>
              <Text style={goStyles.sectionTitle}>CLASSIFICA</Text>
              <View style={goStyles.rankList}>
                {gameState.rankings.map((name, i) => (
                  <RankCard key={i} rank={i} name={name} isWinner={i === 0} delay={i * 100 + 400} />
                ))}
              </View>
            </View>

            <View style={goStyles.section}>
              <Text style={goStyles.sectionTitle}>RIEPILOGO</Text>
              <View style={goStyles.statsGrid}>
                <View style={goStyles.statItem}>
                  <Ionicons name="people" size={20} color={Colors.gold} />
                  <Text style={goStyles.statValue}>{gameState.players.length}</Text>
                  <Text style={goStyles.statLabel}>Giocatori</Text>
                </View>
                <View style={goStyles.statItem}>
                  <Ionicons name={gameState.gameMode === "teams" ? "people-circle" : "person-circle"} size={20} color={Colors.gold} />
                  <Text style={goStyles.statValue}>{gameState.gameMode === "teams" ? "Coppie" : "1 vs 1"}</Text>
                  <Text style={goStyles.statLabel}>Modalità</Text>
                </View>
                <View style={goStyles.statItem}>
                  <Ionicons name="wifi" size={20} color={Colors.accent} />
                  <Text style={goStyles.statValue}>Online</Text>
                  <Text style={goStyles.statLabel}>Modalità</Text>
                </View>
              </View>
            </View>

            <View style={goStyles.actions}>
              <Pressable
                testID="btn-home"
                onPress={() => { leaveRoom(); router.replace("/(online)"); }}
                style={goStyles.homeBtn}
              >
                <Ionicons name="home" size={18} color={Colors.textSecondary} />
                <Text style={goStyles.homeBtnText}>Home</Text>
              </Pressable>

              <Pressable
                testID="btn-rivincita"
                onPress={isHost ? () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); requestPlayAgain(); } : undefined}
                style={[goStyles.rematchBtn, !isHost && goStyles.rematchBtnDim]}
              >
                <LinearGradient
                  colors={isHost ? [Colors.gold, Colors.goldDark] : [Colors.bgSurface, Colors.bgSurface]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={goStyles.rematchGradient}
                >
                  <Ionicons name="refresh" size={18} color={isHost ? "#0A1F18" : Colors.textMuted} />
                  <Text style={[goStyles.rematchText, !isHost && { color: Colors.textMuted }]}>
                    {isHost ? "Rivincita" : "Solo l'host può riavviare"}
                  </Text>
                </LinearGradient>
              </Pressable>
            </View>
          </ScrollView>
        </Animated.View>
      )}
    </View>
  );
}

// ─── Game styles (identical to offline game) ──────────────────────────────────
const styles = StyleSheet.create({
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
  onlineLabel: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textMuted },
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
  turnText: { fontFamily: "Rajdhani_600SemiBold", fontSize: 13, color: Colors.text, flex: 1 },
  cardCountBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  cardCountText: { fontFamily: "Rajdhani_700Bold", fontSize: 14, color: Colors.gold },
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
  emojiBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 8 },
  emojiBtnText: { fontSize: 22 },
  floatingEmoji: { position: "absolute", bottom: "35%", alignItems: "center", zIndex: 200 },
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

  table: {
    position: "absolute",
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 3,
    borderColor: "rgba(201,168,76,0.3)",
  },
  tableInnerBorder: {
    position: "absolute",
    top: 6, left: 6, right: 6, bottom: 6,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "rgba(201,168,76,0.12)",
  },
  tableContent: { flex: 1, flexDirection: "column" },

  topSection: {
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(201,168,76,0.08)",
  },
  topOppSlot: { alignItems: "center", justifyContent: "center", paddingVertical: 6 },
  topOppRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  topOppAvatarCol: { alignItems: "center", gap: 3 },

  midSection: { flex: 1, flexDirection: "row", alignItems: "center" },
  sideSection: { width: SIDE_SECTION_W, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  sideOppSlot: { alignItems: "center", justifyContent: "center", gap: 6 },
  sideLeft: { flexDirection: "row" },
  sideRight: { flexDirection: "row-reverse" },
  sideOppAvatarCol: { alignItems: "center", gap: 3, marginHorizontal: 6 },

  centerSection: { flex: 1, alignItems: "center", justifyContent: "center" },

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
  avatarInitials: { fontFamily: "Rajdhani_700Bold", color: Colors.text, letterSpacing: 0.5 },
  countBubble: {
    position: "absolute",
    bottom: -3, right: -3,
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
  countBubbleText: { fontFamily: "Rajdhani_700Bold", fontSize: 10, color: Colors.gold },

  pileArea: { alignItems: "center", justifyContent: "center", minHeight: 80 },
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
  winnerText: { fontFamily: "Rajdhani_600SemiBold", fontSize: 11, color: Colors.gold },
  emptyText: { fontFamily: "Rajdhani_500Medium", fontSize: 12, color: "rgba(240,234,214,0.18)" },
  pileStack: { alignItems: "center", justifyContent: "center" },
  pileLayer: { position: "absolute", alignItems: "center", justifyContent: "center" },
  pileCards: { flexDirection: "row", alignItems: "flex-end" },
  comboLabel: { marginTop: CARD_H + 12 },
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

  handCenter: { alignItems: "center", justifyContent: "center", height: CARD_H, flexDirection: "row", gap: 6 },
  handRow: { position: "relative", height: CARD_H, alignSelf: "center" },
  handCardWrap: { position: "absolute", bottom: 0 },
  emptyHandText: { fontFamily: "Rajdhani_600SemiBold", fontSize: 13, color: Colors.gold },
  finishedRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  finishedText: { fontFamily: "Rajdhani_600SemiBold", fontSize: 13, color: Colors.gold },

  passBtn: {
    position: "absolute",
    width: BTN_W, height: BTN_H,
    borderRadius: BTN_H / 2,
    backgroundColor: "#5C1212",
    alignItems: "center", justifyContent: "center",
    borderWidth: 2.5, borderColor: "#8B1A1A",
    zIndex: 20,
    shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 10,
  },
  passBtnDim: { backgroundColor: "rgba(50,12,12,0.55)", borderColor: "rgba(100,20,20,0.35)", shadowOpacity: 0 },
  passBtnLabel: { fontFamily: "Rajdhani_700Bold", fontSize: 15, color: "#FF8080", letterSpacing: 1 },
  passBtnLabelDim: { color: "rgba(255,128,128,0.3)" },

  playBtn: {
    position: "absolute",
    width: BTN_W, height: BTN_H,
    borderRadius: BTN_H / 2,
    overflow: "hidden",
    zIndex: 20,
    shadowColor: Colors.gold, shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 10,
  },
  playBtnDim: { shadowOpacity: 0 },
  playBtnGrad: { flex: 1, alignItems: "center", justifyContent: "center", gap: 1 },
  playBtnGradDim: {
    backgroundColor: "rgba(40,30,5,0.55)",
    borderWidth: 2.5,
    borderColor: "rgba(201,168,76,0.2)",
    borderRadius: BTN_H / 2,
  },
  playBtnLabel: { fontFamily: "Rajdhani_700Bold", fontSize: 15, color: "#0A1F10", letterSpacing: 1 },
  playBtnSub: { fontFamily: "Rajdhani_500Medium", fontSize: 9, color: "#0A1F10", opacity: 0.7 },
  playBtnLabelDim: { fontFamily: "Rajdhani_600SemiBold", fontSize: 11, color: "rgba(201,168,76,0.3)", letterSpacing: 0.5, textAlign: "center" },

  flyingContainer: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", zIndex: 60 },
  flyingInner: { width: CARD_W * 2.5, height: CARD_H, alignItems: "center", justifyContent: "center" },
});

// ─── Game over result styles ──────────────────────────────────────────────────
const goStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(6,20,16,0.95)",
    zIndex: 300,
  },
  scroll: { padding: 20, gap: 28, alignItems: "stretch" },
  title: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 22,
    color: Colors.text,
    letterSpacing: 2,
    textAlign: "center",
  },
  celebration: { alignItems: "center", gap: 12, paddingVertical: 16 },
  celebrationGlow: {
    position: "absolute",
    width: 160, height: 160, borderRadius: 80,
    backgroundColor: Colors.gold, top: 0, opacity: 0.08,
  },
  trophyCircle: { width: 100, height: 100, borderRadius: 50, overflow: "hidden", borderWidth: 2, borderColor: Colors.gold },
  trophyGradient: { flex: 1, alignItems: "center", justifyContent: "center" },
  winnerName: { fontFamily: "Rajdhani_700Bold", fontSize: 32, color: Colors.text, letterSpacing: 2 },
  winnerSubtitle: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.gold, letterSpacing: 3, textTransform: "uppercase" },

  section: { gap: 12 },
  sectionTitle: { fontFamily: "Inter_600SemiBold", fontSize: 11, color: Colors.textMuted, letterSpacing: 2 },
  rankList: { gap: 10 },
  rankCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: Colors.bgSurface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  rankCardWinner: { borderColor: Colors.gold },
  positionBadge: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  positionLabel: { fontFamily: "Rajdhani_700Bold", fontSize: 14 },
  playerName: { fontFamily: "Rajdhani_600SemiBold", fontSize: 17, color: Colors.text, flex: 1 },
  winnerBadge: { backgroundColor: Colors.goldMuted, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: Colors.goldDark },
  winnerBadgeText: { fontFamily: "Rajdhani_700Bold", fontSize: 10, color: Colors.gold, letterSpacing: 1 },

  statsGrid: { flexDirection: "row", gap: 10 },
  statItem: { flex: 1, backgroundColor: Colors.bgSurface, borderRadius: 12, padding: 14, alignItems: "center", gap: 6, borderWidth: 1, borderColor: Colors.border },
  statValue: { fontFamily: "Rajdhani_700Bold", fontSize: 18, color: Colors.text },
  statLabel: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textMuted },

  actions: { flexDirection: "row", gap: 12, paddingTop: 4 },
  homeBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 16, paddingHorizontal: 20,
    borderRadius: 14,
    backgroundColor: Colors.bgSurface,
    borderWidth: 1, borderColor: Colors.border,
  },
  homeBtnText: { fontFamily: "Rajdhani_600SemiBold", fontSize: 16, color: Colors.textSecondary },
  rematchBtn: { flex: 1, borderRadius: 14, overflow: "hidden" },
  rematchBtnDim: { opacity: 0.6 },
  rematchGradient: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 16 },
  rematchText: { fontFamily: "Rajdhani_700Bold", fontSize: 17, color: "#0A1F18", letterSpacing: 0.5 },
});
