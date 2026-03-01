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
import { buildCombination, canPlay, sortHand, Card, Combination } from "@/lib/gameEngine";
import type { Reaction } from "@/context/OnlineGameContext";
import Colors from "@/constants/colors";

const CARD_W = 58;
const CARD_H = 84;
const TOP_BAR_H = 44;

const EMOJIS = ["😂", "🔥", "😤", "👏", "😱", "🤡", "💣", "👑"];

// ─── Sub-components ─────────────────────────────────────────────────────────

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
    if (isActive) pulse.value = withSequence(withTiming(1.1, { duration: 350 }), withTiming(1, { duration: 350 }));
  }, [isActive]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <Animated.View style={anim}>
      <View style={[styles.avatarOuter, { width: size + 6, height: size + 6, borderRadius: (size + 6) / 2 }, isActive && styles.avatarOuterActive]}>
        <View style={[styles.avatarInner, { width: size, height: size, borderRadius: size / 2 }]}>
          <Text style={[styles.avatarInitials, { fontSize: size * 0.36 }]}>{initials}</Text>
        </View>
        <View style={styles.countBubble}>
          {finishPos !== undefined
            ? <Ionicons name="trophy" size={8} color={Colors.gold} />
            : <Text style={styles.countBubbleText}>{cardCount}</Text>}
        </View>
      </View>
    </Animated.View>
  );
}

function CardItem({
  card, isSelected, left, onPress, disabled, zIndex,
}: {
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

function FloatingReaction({ reaction, seatCount }: { reaction: Reaction; seatCount: number }) {
  const y = useSharedValue(0);
  const opacity = useSharedValue(1);
  useEffect(() => {
    y.value = withTiming(-80, { duration: 1800 });
    opacity.value = withSequence(
      withTiming(1, { duration: 200 }),
      withTiming(0, { duration: 1600 })
    );
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
        <Pressable
          key={e}
          onPress={() => { onSelect(e); onClose(); }}
          style={({ pressed }) => [styles.emojiBtn, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.emojiBtnText}>{e}</Text>
        </Pressable>
      ))}
    </Animated.View>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function OnlineGameScreen() {
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const { user } = useAuth();
  const {
    gameState,
    reactions,
    mySeatIndex,
    error,
    clearError,
    playCards,
    pass,
    sendReaction,
    leaveRoom,
  } = useOnlineGame();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [roundWinner, setRoundWinner] = useState<string | null>(null);
  const [playedPile, setPlayedPile] = useState<Combination[]>([]);
  const [showReactions, setShowReactions] = useState(false);
  const [showGameOver, setShowGameOver] = useState(false);
  const prevComboRef = useRef<Combination | null>(null);
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
    if (combo !== null && combo !== prevComboRef.current) {
      setPlayedPile((prev) => [...prev.slice(-5), combo]);
    }
    if (combo === null) setPlayedPile([]);
    prevComboRef.current = combo;
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
      setTimeout(() => setShowGameOver(true), 800);
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

  const opponents = gameState.players
    .map((p, i) => ({ ...p, idx: i }))
    .filter((_, i) => i !== mySeatIndex);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const HAND_H = CARD_H + 14;
  const tableH = H - TOP_BAR_H - topPad - HAND_H - bottomPad - 16;
  const SIDE_W = 140;
  const centerW = W - SIDE_W * 2 - 8;

  function toggleCard(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
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

  const n = sortedHand.length;
  const step = n > 1 ? Math.max(20, Math.min(CARD_W, (W - CARD_W - 100) / (n - 1))) : CARD_W;
  const totalW = step * (n - 1) + CARD_W;

  return (
    <View style={[styles.container, { paddingTop: topPad, paddingBottom: bottomPad }]}>
      <LinearGradient
        colors={[Colors.bg, Colors.feltDark]}
        locations={[0, 1]}
        style={StyleSheet.absoluteFill}
      />

      {reactions.map((r) => (
        <FloatingReaction key={r.id} reaction={r} seatCount={gameState.players.length} />
      ))}

      <View style={[styles.topBar, { height: TOP_BAR_H }]}>
        <View style={styles.topLeft}>
          <View style={[styles.dot, { backgroundColor: "#4CAF50" }]} />
          <Text style={styles.onlineLabel}>Online</Text>
        </View>

        <View style={styles.topCenter}>
          {isMyTurn && !isFinished && (
            <Animated.View entering={FadeIn.duration(300)} exiting={FadeOut.duration(200)} style={styles.myTurnBadge}>
              <Text style={styles.myTurnText}>Il tuo turno</Text>
            </Animated.View>
          )}
          {!isMyTurn && (
            <Text style={styles.waitingText}>
              Turno: {gameState.players[gameState.currentTurnIndex]?.name}
            </Text>
          )}
        </View>

        <View style={styles.topRight}>
          <Pressable onPress={handleReactionBtnPress} style={styles.reactionTrigger}>
            <Text style={styles.reactionTriggerText}>💬</Text>
          </Pressable>
        </View>
      </View>

      {showReactions && (
        <ReactionPanel onSelect={handleReaction} onClose={() => setShowReactions(false)} />
      )}

      <View style={[styles.table, { height: tableH }]}>
        {opponents.slice(0, 1).map((opp) => (
          <View key={opp.idx} style={styles.topOpp}>
            <AvatarCircle
              name={opp.name}
              isActive={gameState.currentTurnIndex === opp.idx}
              cardCount={(opp as any).handCount ?? opp.hand.length}
              finishPos={opp.finishPosition}
              size={40}
            />
            <Text style={styles.oppName} numberOfLines={1}>{opp.name}</Text>
            <CardFan count={(opp as any).handCount ?? opp.hand.length} maxCards={7} />
          </View>
        ))}

        <View style={[styles.centerArea, { width: centerW }]}>
          {roundWinner && (
            <Animated.View entering={FadeIn.duration(250)} exiting={FadeOut.duration(250)} style={styles.winnerTag}>
              <Ionicons name="star" size={9} color={Colors.gold} />
              <Text style={styles.winnerText}>{roundWinner}</Text>
            </Animated.View>
          )}
          {playedPile.length === 0 && (
            <Text style={styles.emptyText}>
              {gameState.firstPlayMade ? "Nuovo round" : "Gioca il 3♠"}
            </Text>
          )}
          {playedPile.length > 0 && (
            <View style={styles.pileStack}>
              {playedPile.slice(-3).map((combo, si, arr) => {
                const isTop = si === arr.length - 1;
                return (
                  <View
                    key={si}
                    style={[
                      styles.pileLayer,
                      { zIndex: si, opacity: isTop ? 1 : 0.4 + si * 0.2, transform: [{ rotate: `${(si - arr.length + 1) * 7}deg` }] },
                    ]}
                  >
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
            </View>
          )}
        </View>

        <View style={styles.sideOpps}>
          {opponents.slice(1).map((opp) => (
            <View key={opp.idx} style={styles.sideOpp}>
              <AvatarCircle
                name={opp.name}
                isActive={gameState.currentTurnIndex === opp.idx}
                cardCount={(opp as any).handCount ?? opp.hand.length}
                finishPos={opp.finishPosition}
                size={36}
              />
              <Text style={styles.oppName} numberOfLines={1}>{opp.name}</Text>
              <CardFan count={(opp as any).handCount ?? opp.hand.length} maxCards={5} />
            </View>
          ))}
        </View>
      </View>

      <View style={styles.handArea}>
        <View style={styles.handRow}>
          {sortedHand.length === 0 ? (
            <View style={styles.handCenter}>
              <Ionicons name="checkmark-circle" size={24} color={Colors.gold} />
              <Text style={styles.emptyHandText}>Carte finite!</Text>
            </View>
          ) : (
            <View style={{ width: Math.min(totalW, W - 100) }}>
              {sortedHand.map((card, i) => (
                <CardItem
                  key={card.id}
                  card={card}
                  isSelected={selectedIds.includes(card.id)}
                  left={i * step}
                  onPress={() => toggleCard(card.id)}
                  disabled={!isMyTurn || isFinished}
                  zIndex={i}
                />
              ))}
            </View>
          )}
        </View>

        <View style={styles.actionBtns}>
          <Pressable
            onPress={handlePass}
            disabled={!canPassNow}
            style={[styles.passBtn, !canPassNow && { opacity: 0.35 }]}
          >
            <Text style={styles.passBtnText}>Passa</Text>
          </Pressable>
          <Pressable
            onPress={handlePlay}
            disabled={!playBtnValid}
            style={({ pressed }) => [
              styles.playBtn,
              !playBtnValid && styles.playBtnDisabled,
              pressed && { opacity: 0.85 },
            ]}
          >
            <LinearGradient
              colors={playBtnValid ? [Colors.gold, Colors.goldDark] : [Colors.bgSurface, Colors.bgSurface]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={styles.playBtnGrad}
            >
              <Text style={[styles.playBtnText, !playBtnValid && { color: Colors.textMuted }]}>
                {selectedIds.length > 0 && tentativeCombo
                  ? ({ single: "Gioca", pair: "Gioca coppia", triple: "Gioca tris", straight: "Gioca scala", bomb: "💣 Bomba!", royal_straight: "★ Reale!" } as Record<string, string>)[tentativeCombo.type]
                  : "Gioca"}
              </Text>
            </LinearGradient>
          </Pressable>
        </View>
      </View>

      {showGameOver && gameState.gameOver && (
        <Animated.View entering={FadeIn.duration(400)} style={styles.gameOverOverlay}>
          <View style={styles.gameOverCard}>
            <Text style={styles.gameOverTitle}>Partita Finita!</Text>
            <View style={styles.gameOverRankings}>
              {gameState.rankings.map((name, i) => (
                <View key={i} style={styles.rankRow}>
                  <Text style={[styles.rankPos, { color: i === 0 ? Colors.gold : Colors.textMuted }]}>
                    {["🥇", "🥈", "🥉", "4°"][i] ?? `${i + 1}°`}
                  </Text>
                  <Text style={[styles.rankName, { color: i === 0 ? Colors.gold : Colors.text }]}>
                    {name}
                  </Text>
                </View>
              ))}
            </View>
            <Pressable
              onPress={() => { leaveRoom(); router.replace("/(online)"); }}
              style={styles.gameOverBtn}
            >
              <LinearGradient
                colors={[Colors.gold, Colors.goldDark]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={styles.gameOverBtnGrad}
              >
                <Text style={styles.gameOverBtnText}>Torna al Menu</Text>
              </LinearGradient>
            </Pressable>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  topLeft: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  onlineLabel: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textMuted },
  topCenter: { flex: 2, alignItems: "center" },
  myTurnBadge: {
    backgroundColor: "rgba(201,168,76,0.18)",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.goldDark,
  },
  myTurnText: { fontFamily: "Rajdhani_700Bold", fontSize: 13, color: Colors.gold, letterSpacing: 0.5 },
  waitingText: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textMuted },
  topRight: { flex: 1, alignItems: "flex-end" },
  reactionTrigger: { padding: 8 },
  reactionTriggerText: { fontSize: 22 },
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
  table: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8 },
  topOpp: { flex: 1, alignItems: "center", gap: 4 },
  sideOpps: { width: 100, gap: 12, alignItems: "flex-end" },
  sideOpp: { alignItems: "center", gap: 4 },
  centerArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 80,
  },
  pileStack: { alignItems: "center", justifyContent: "center" },
  pileLayer: { position: "absolute" },
  pileCards: { flexDirection: "row" },
  winnerTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(201,168,76,0.15)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 4,
  },
  winnerText: { fontFamily: "Rajdhani_600SemiBold", fontSize: 11, color: Colors.gold },
  emptyText: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textMuted, textAlign: "center" },
  oppName: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textMuted, maxWidth: 70 },
  handArea: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 8,
    height: CARD_H + 14,
  },
  handRow: { flex: 1, height: CARD_H + 14, position: "relative", justifyContent: "flex-end" },
  handCenter: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, height: CARD_H },
  emptyHandText: { fontFamily: "Rajdhani_600SemiBold", fontSize: 15, color: Colors.gold },
  handCardWrap: { position: "absolute", bottom: 0, width: CARD_W, height: CARD_H },
  actionBtns: { gap: 8, justifyContent: "flex-end", paddingBottom: 4 },
  passBtn: {
    width: 84,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bgSurface,
  },
  passBtnText: { fontFamily: "Rajdhani_600SemiBold", fontSize: 14, color: Colors.textMuted },
  playBtn: { width: 84, height: 44, borderRadius: 10, overflow: "hidden" },
  playBtnDisabled: {},
  playBtnGrad: { flex: 1, alignItems: "center", justifyContent: "center" },
  playBtnText: { fontFamily: "Rajdhani_700Bold", fontSize: 14, color: "#0A1F18", textAlign: "center" },
  avatarOuter: { position: "relative", backgroundColor: "transparent", alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: Colors.border },
  avatarOuterActive: { borderColor: Colors.gold },
  avatarInner: { backgroundColor: Colors.felt, alignItems: "center", justifyContent: "center" },
  avatarInitials: { fontFamily: "Rajdhani_700Bold", color: Colors.gold },
  countBubble: {
    position: "absolute",
    bottom: -4,
    right: -4,
    backgroundColor: Colors.bgCard,
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  countBubbleText: { fontFamily: "Inter_500Medium", fontSize: 9, color: Colors.text },
  gameOverOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.8)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 300,
  },
  gameOverCard: {
    backgroundColor: Colors.bgSurface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.goldDark,
    padding: 28,
    width: 280,
    alignItems: "center",
    gap: 20,
  },
  gameOverTitle: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 26,
    color: Colors.text,
    letterSpacing: 2,
  },
  gameOverRankings: { width: "100%", gap: 10 },
  rankRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 4,
  },
  rankPos: { fontFamily: "Rajdhani_700Bold", fontSize: 22, width: 36, textAlign: "center" },
  rankName: { fontFamily: "Inter_500Medium", fontSize: 15, flex: 1 },
  gameOverBtn: { width: "100%", borderRadius: 12, overflow: "hidden" },
  gameOverBtnGrad: { paddingVertical: 14, alignItems: "center" },
  gameOverBtnText: { fontFamily: "Rajdhani_700Bold", fontSize: 17, color: "#0A1F18" },
});
