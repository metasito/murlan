import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Platform, Pressable, ScrollView } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  withSequence,
  withRepeat,
  Easing,
  runOnJS,
  cancelAnimation,
  interpolate,
  Extrapolation,
  FadeIn,
  FadeOut,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { CardView } from "@/components/CardView";
import { Colors, FontSize, Motion, Radius, Shadow, Spacing } from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import type { Card, Combination, Player, StartReason } from "@/lib/gameEngine";
import { CARD_W, computeHandLayout } from "@/components/handLayout";
import {
  CARD_H,
  HAND_SECTION_H,
  SIDE_SECTION_W,
  type FlyDirection,
} from "@/components/gameTableModel";

// The layout constants and the seat-rotation maths now live in the JSX-free
// gameTableModel.ts so they can be unit-tested and so the shared table can use
// them without importing this file. Re-exported here unchanged — every existing
// `import { CARD_H, ... } from "@/components/GameShared"` keeps working.
export { CARD_W };
export {
  CARD_H,
  BTN_W,
  BTN_H,
  SIDE_BTN_W,
  TOP_BAR_H,
  TABLE_M,
  SIDE_SECTION_W,
  TOP_SECTION_H,
  HAND_SECTION_H,
  getOpponentPosition,
  type FlyDirection,
} from "@/components/gameTableModel";

// Extra top clearance the fixed HAND_SECTION_H already gives the CARD_H-tall
// hand row (it's centered inside the taller section). Reused as the
// ScrollView headroom in StraightHand's scrollable fallback — see there.
const HAND_LIFT_HEADROOM = HAND_SECTION_H - CARD_H;

export const FLY_OFFSETS: Record<FlyDirection, { dx: number; dy: number }> = {
  bottom: { dx: 0, dy: 140 },
  top:    { dx: 0, dy: -100 },
  left:   { dx: -180, dy: 0 },
  right:  { dx: 180, dy: 0 },
};
const FLY_ROTS: Record<FlyDirection, number> = {
  bottom: -12, top: 12, left: -18, right: 18,
};
const FLY_LANDING_ROTS: Record<FlyDirection, number> = {
  bottom: -4, top: 5, left: -7, right: 7,
};

// ─── Table vignette ───────────────────────────────────────────────────────────

// The four gradient stops below are a plain black wash (not gold), so the
// gold-alpha scale doesn't apply, and Colors has no black-overlay entries to
// match against (Colors.overlay is a different rgb and alpha) — left inline.
export function TableVignette() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Top edge */}
      <LinearGradient
        colors={["rgba(0,0,0,0.30)", "transparent"]}
        style={vignetteStyles.top}
        pointerEvents="none"
      />
      {/* Bottom edge */}
      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.30)"]}
        style={vignetteStyles.bottom}
        pointerEvents="none"
      />
      {/* Left edge */}
      <LinearGradient
        colors={["rgba(0,0,0,0.22)", "transparent"]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={vignetteStyles.left}
        pointerEvents="none"
      />
      {/* Right edge */}
      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.22)"]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={vignetteStyles.right}
        pointerEvents="none"
      />
    </View>
  );
}

const vignetteStyles = StyleSheet.create({
  top:    { position: "absolute", top: 0, left: 0, right: 0, height: "18%" },
  bottom: { position: "absolute", bottom: 0, left: 0, right: 0, height: "18%" },
  left:   { position: "absolute", top: 0, bottom: 0, left: 0, width: "14%" },
  right:  { position: "absolute", top: 0, bottom: 0, right: 0, width: "14%" },
});

// ─── CardFan ──────────────────────────────────────────────────────────────────

export function CardFan({
  count,
  maxCards = 7,
}: {
  count: number;
  maxCards?: number;
}) {
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

// ─── AvatarCircle ─────────────────────────────────────────────────────────────

export function AvatarCircle({
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
        withTiming(1.15, { duration: Motion.duration.moderate }),
        withSpring(1, Motion.spring.settle)
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
          sharedStyles.avatarOuter,
          { width: size + 6, height: size + 6, borderRadius: (size + 6) / 2 },
          isActive && sharedStyles.avatarOuterActive,
        ]}
      >
        <LinearGradient
          colors={["#0D4A2E", Colors.felt]} // #0D4A2E: gradient-only stop between felt and feltLight, no exact token
          style={[
            sharedStyles.avatarInner,
            { width: size, height: size, borderRadius: size / 2 },
          ]}
        >
          <Text style={[sharedStyles.avatarInitials, { fontSize: size * 0.36 }]}>
            {initials}
          </Text>
        </LinearGradient>
        <View style={[
          sharedStyles.countBubble,
          finishPos !== undefined && sharedStyles.countBubbleFinished,
        ]}>
          {finishPos !== undefined ? (
            <Ionicons name="trophy" size={8} color={Colors.gold} />
          ) : (
            <Text style={sharedStyles.countBubbleText}>{cardCount}</Text>
          )}
        </View>
      </View>
    </Animated.View>
  );
}

// ─── TopOppSlot ───────────────────────────────────────────────────────────────

export function TopOppSlot({
  player,
  isActive,
  cardCount,
}: {
  player: Player;
  isActive: boolean;
  cardCount?: number;
}) {
  const count = cardCount ?? player.hand.length;
  return (
    <View style={sharedStyles.topOppSlot}>
      <View style={sharedStyles.topOppRow}>
        <View style={sharedStyles.topOppAvatarCol}>
          <AvatarCircle
            name={player.name}
            isActive={isActive}
            cardCount={count}
            finishPos={player.finishPosition}
            size={42}
          />
          <Text style={sharedStyles.oppName} numberOfLines={1}>
            {player.name}
          </Text>
        </View>
        {player.finishPosition === undefined && count > 0 && (
          <CardFan count={count} maxCards={7} />
        )}
      </View>
    </View>
  );
}

// ─── SideOppSlot ──────────────────────────────────────────────────────────────

export function SideOppSlot({
  player,
  isActive,
  side,
  cardCount,
}: {
  player: Player;
  isActive: boolean;
  side: "left" | "right";
  cardCount?: number;
}) {
  const count = cardCount ?? player.hand.length;
  const isLeft = side === "left";
  return (
    <View
      style={[
        sharedStyles.sideOppSlot,
        isLeft ? sharedStyles.sideLeft : sharedStyles.sideRight,
      ]}
    >
      {!isLeft && count > 0 && player.finishPosition === undefined && (
        <CardFan count={count} maxCards={5} />
      )}
      <View style={sharedStyles.sideOppAvatarCol}>
        <AvatarCircle
          name={player.name}
          isActive={isActive}
          cardCount={count}
          finishPos={player.finishPosition}
          size={40}
        />
        <Text style={sharedStyles.oppName} numberOfLines={1}>
          {player.name}
        </Text>
      </View>
      {isLeft && count > 0 && player.finishPosition === undefined && (
        <CardFan count={count} maxCards={5} />
      )}
    </View>
  );
}

// ─── FlyingCards ──────────────────────────────────────────────────────────────

export function FlyingCards({
  cards,
  direction,
  onDone,
}: {
  cards: Card[];
  direction: FlyDirection;
  onDone: () => void;
}) {
  const { dx, dy } = FLY_OFFSETS[direction];
  const startRot = FLY_ROTS[direction];
  const landingRot = FLY_LANDING_ROTS[direction];

  const tx = useSharedValue(dx);
  const ty = useSharedValue(dy);
  const rot = useSharedValue(startRot);
  const scale = useSharedValue(0.85);
  const opacity = useSharedValue(0);
  // Parabolic arc — peak at mid-flight, then land
  const arcY = useSharedValue(0);

  useEffect(() => {
    const FLIGHT = 380;
    const easing = Easing.bezier(0.22, 0.61, 0.36, 1.0);

    opacity.value = withTiming(1, { duration: 60 });
    tx.value = withTiming(0, { duration: FLIGHT, easing });
    ty.value = withTiming(0, { duration: FLIGHT, easing });
    rot.value = withTiming(landingRot, { duration: FLIGHT, easing: Easing.out(Easing.cubic) });
    // Arc: rise to -20 at midpoint, then land
    arcY.value = withSequence(
      withTiming(-20, { duration: FLIGHT * 0.5, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: FLIGHT * 0.5, easing: Easing.in(Easing.quad) })
    );
    scale.value = withSequence(
      withTiming(1.06, { duration: FLIGHT * 0.65, easing: Easing.out(Easing.cubic) }),
      withSpring(0.97, { damping: 18, stiffness: 320 }),
      withSpring(1.0, { damping: 30, stiffness: 180 }, (finished) => {
        if (finished) runOnJS(onDone)();
      })
    );

    return () => {
      cancelAnimation(tx);
      cancelAnimation(ty);
      cancelAnimation(rot);
      cancelAnimation(scale);
      cancelAnimation(opacity);
      cancelAnimation(arcY);
    };
  }, []);

  const aStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value + arcY.value },
      { rotate: `${rot.value}deg` },
      { scale: scale.value },
    ],
    opacity: opacity.value,
  }));

  const display = cards;

  return (
    <View style={[sharedStyles.flyingContainer, { pointerEvents: "none" as const }]}>
      <Animated.View style={[sharedStyles.flyingInner, aStyle]}>
        {display.map((card, i) => {
          const angle = (i - (display.length - 1) / 2) * 10;
          const overlap = display.length > 7 ? 8 : display.length > 4 ? 10 : 12;
          return (
            <View
              key={card.id}
              style={{
                position: "absolute",
                left: i * overlap - (display.length - 1) * (overlap / 2),
                zIndex: i,
                transform: [{ rotate: `${angle}deg` }],
              }}
            >
              <CardView card={card} />
            </View>
          );
        })}
      </Animated.View>
    </View>
  );
}

// ─── PlayedPile ───────────────────────────────────────────────────────────────

const COMBO_LABEL_KEYS: Record<string, TranslationKey> = {
  single:        "gameShared.comboSingle",
  pair:          "gameShared.comboPair",
  triple:        "gameShared.comboTriple",
  straight:      "gameShared.comboStraight",
  bomb:          "gameShared.comboBomb",
  royal_straight: "gameShared.comboRoyalStraight",
};

const POWER_COMBOS = new Set(["bomb", "royal_straight"]);

function PileComboCards({ cards }: { cards: Card[] }) {
  const overlap = cards.length > 8 ? 9 : cards.length > 5 ? 12 : 14;
  const totalW = overlap * (cards.length - 1) + CARD_W;
  return (
    <View style={{ width: totalW, height: CARD_H, position: "relative" }}>
      {cards.map((card, ci) => (
        <View
          key={card.id}
          style={{ position: "absolute", left: ci * overlap, zIndex: ci }}
        >
          <CardView card={card} />
        </View>
      ))}
    </View>
  );
}

export function PlayedPile({
  prev,
  current,
  roundWinner,
  bounceTrigger,
}: {
  prev: Combination | null;
  current: Combination | null;
  roundWinner: string | null;
  bounceTrigger?: number;
}) {
  const { t } = useTranslation();
  const bounceScale = useSharedValue(1);

  useEffect(() => {
    if (!bounceTrigger) return;
    bounceScale.value = withSequence(
      withSpring(1.05, { damping: 10, stiffness: 420 }),
      withSpring(1.0, { damping: 16, stiffness: 280 })
    );
  }, [bounceTrigger]);

  const bounceStyle = useAnimatedStyle(() => ({
    transform: [{ scale: bounceScale.value }],
  }));

  const isPower = current && POWER_COMBOS.has(current.type);

  return (
    <Animated.View style={[sharedStyles.pileArea, bounceStyle]} testID="pile-area">
      {roundWinner && (
        <Animated.View
          entering={FadeIn.duration(250)}
          exiting={FadeOut.duration(250)}
          style={sharedStyles.winnerTag}
        >
          <Ionicons name="star" size={9} color={Colors.gold} />
          <Text style={sharedStyles.winnerText}>{roundWinner}</Text>
        </Animated.View>
      )}

      <View style={sharedStyles.pileStack}>
        {prev && (
          <View style={sharedStyles.pilePrevLayer}>
            <PileComboCards cards={prev.cards} />
          </View>
        )}
        {current && (
          <View style={sharedStyles.pileCurrentLayer}>
            <PileComboCards cards={current.cards} />
          </View>
        )}
      </View>

      {current && (
        <View style={sharedStyles.comboLabel}>
          <View style={[sharedStyles.comboChip, isPower && sharedStyles.comboChipPower]}>
            <Text style={[sharedStyles.comboChipText, isPower && sharedStyles.comboChipTextPower]}>
              {isPower ? "✦ " : ""}
              {COMBO_LABEL_KEYS[current.type] ? t(COMBO_LABEL_KEYS[current.type]) : current.type}
              {current.cards.length > 2 ? t("gameShared.comboMultiplier", { count: current.cards.length }) : ""}
            </Text>
          </View>
        </View>
      )}
    </Animated.View>
  );
}

// ─── CardItem ─────────────────────────────────────────────────────────────────
//
// `onPress` takes the card id rather than being a bound zero-arg callback.
// The caller (StraightHand, below) passes its own `onPress` prop straight
// through — unchanged reference per card — instead of minting a new
// `() => onPress(card.id)` closure per card on every render. CardItem binds
// its own id once here via useCallback, so CardView only ever sees a new
// `onPress` reference when this card's id or the caller's callback actually
// changes, not whenever some other card's selection state changes.
export function CardItem({
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
  onPress: (id: string) => void;
  disabled: boolean;
  zIndex: number;
}) {
  const liftY = useSharedValue(0);
  const cardScale = useSharedValue(1);

  useEffect(() => {
    liftY.value = withSpring(isSelected ? -14 : 0, {
      damping: 12,
      stiffness: 280,
    });
    cardScale.value = withSpring(isSelected ? 1.04 : 1.0, {
      damping: 10,
      stiffness: 260,
    });
  }, [isSelected]);

  const aStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: liftY.value },
      { scale: cardScale.value },
    ],
  }));

  const cardId = card.id;
  const handlePress = useCallback(() => onPress(cardId), [onPress, cardId]);

  return (
    <Animated.View
      style={[sharedStyles.handCardWrap, { left, zIndex }, aStyle]}
    >
      <CardView
        card={card}
        selected={isSelected}
        onPress={handlePress}
        disabled={disabled}
        noLift
      />
    </Animated.View>
  );
}

// ─── StraightHand ─────────────────────────────────────────────────────────────

export function StraightHand({
  cards,
  selectedIds,
  onPress,
  disabled,
  availW,
  isMyTurn,
}: {
  cards: Card[];
  selectedIds: string[];
  onPress: (id: string) => void;
  disabled: boolean;
  availW: number;
  isMyTurn?: boolean;
}) {
  const { t } = useTranslation();
  const n = cards.length;
  // O(1) membership check per card instead of `selectedIds.includes(card.id)`
  // (an O(k) scan repeated for every one of the up to 27 cards in a hand).
  // Computed before the early return below — Rules of Hooks requires every
  // hook to run unconditionally on every render of this component.
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  if (n === 0) {
    return (
      <View style={[sharedStyles.handCenter, { width: availW }]}>
        <Ionicons name="checkmark-circle" size={24} color={Colors.gold} />
        <Text style={sharedStyles.emptyHandText}>{t("gameShared.emptyHand")}</Text>
      </View>
    );
  }
  const { step, totalW, scrollable } = computeHandLayout(n, availW);

  const row = (
    <View style={[sharedStyles.handRow, { width: scrollable ? totalW : Math.min(totalW, availW) }]}>
      {cards.map((card, i) => (
        <CardItem
          key={card.id}
          card={card}
          isSelected={selectedSet.has(card.id)}
          left={i * step}
          onPress={onPress}
          disabled={disabled}
          zIndex={i}
        />
      ))}
    </View>
  );

  return (
    <View style={[sharedStyles.handCenter, { width: availW }]}>
      <View
        style={[
          sharedStyles.handGlowWrap,
          isMyTurn && sharedStyles.handGlowWrapActive,
        ]}
      >
        {scrollable ? (
          // Too many cards to keep the readable minimum step inside availW
          // (e.g. a 27-card hand on a narrow device). Scroll instead of
          // clipping or shrinking the step past legibility. HAND_LIFT_HEADROOM
          // reproduces the same top clearance the fixed-height, non-scrolling
          // path gets for free from HAND_SECTION_H (CARD_H + 16) being taller
          // than the CARD_H row it centers — without it, the ScrollView's own
          // clipping bounds would cut off the -14px selection lift.
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ width: availW, height: CARD_H + HAND_LIFT_HEADROOM }}
            contentContainerStyle={{ paddingTop: HAND_LIFT_HEADROOM, width: totalW }}
          >
            {row}
          </ScrollView>
        ) : (
          row
        )}
      </View>
    </View>
  );
}

// ─── StartReasonBanner ────────────────────────────────────────────────────────

export function StartReasonBanner({
  reason,
  players,
  topOffset,
}: {
  reason: StartReason;
  players: Array<{ name: string; type: string }>;
  topOffset: number;
}) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(timer);
  }, []);
  if (!visible) return null;

  const playerName = players[reason.playerIdx]?.name ?? "?";
  let mainText = "";
  let subText = "";

  if (reason.type === "start_card" && reason.card) {
    mainText = t("gameShared.startReasonCard", { name: playerName, rank: reason.card.rank });
    if (reason.card.rank !== "3") subText = t("gameShared.startReasonCardSub");
  } else if (reason.type === "lost_round") {
    mainText = t("gameShared.startReasonLostRound", { name: playerName });
  } else if (reason.type === "won_no_swap") {
    mainText = t("gameShared.startReasonWonNoSwap", { name: playerName });
  }

  return (
    <Pressable
      onPress={() => setVisible(false)}
      style={{
        position: "absolute",
        top: topOffset,
        left: 0,
        right: 0,
        alignItems: "center",
        zIndex: 50,
        pointerEvents: "box-none" as any,
      }}
    >
      <View style={{
        // rgba(3,16,8,0.90): near-Colors.bg wash at a one-off alpha — no
        // Colors entry composes bg with a custom alpha, left inline.
        backgroundColor: "rgba(3,16,8,0.90)",
        borderColor: Colors.gold,
        borderWidth: 1,
        borderRadius: Radius.lg,
        paddingHorizontal: 18,
        paddingVertical: Spacing.sm,
        alignItems: "center",
        maxWidth: 420,
        gap: 2,
      }}>
        <Text style={{ fontFamily: "Rajdhani_600SemiBold", fontSize: 14, color: Colors.gold, letterSpacing: 0.5, textAlign: "center" }}>
          {mainText}
        </Text>
        {subText ? (
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: FontSize.xs, color: Colors.textSecondary, textAlign: "center" }}>
            {subText}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

// ─── Portrait overlay ─────────────────────────────────────────────────────────

export const portraitOverlayStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    // rgba(3,16,8,0.97): near-Colors.bg wash at a one-off alpha, same
    // rationale as StartReasonBanner above — left inline.
    backgroundColor: "rgba(3,16,8,0.97)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 999,
  },
  card: {
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: 40,
  },
  title: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 26,
    color: Colors.text,
    letterSpacing: 1,
    textAlign: "center",
  },
  sub: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
});

// ─── Shared table styles ──────────────────────────────────────────────────────

export const sharedTableStyles = StyleSheet.create({
  tableBg: {
    position: "absolute",
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 3.5,
    borderColor: Colors.goldStrong,
  },
  tableOverlay: {
    position: "absolute",
    overflow: "visible",
  },
  tableInnerBorder: {
    position: "absolute",
    top: 6,
    left: 6,
    right: 6,
    bottom: 6,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: Colors.goldSoft,
  },
  tableContent: { flex: 1, flexDirection: "column" },
  topSection: {
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 1,
    // Nearly-invisible by design (0.08) — nearest step is goldGhost (0.06).
    borderBottomColor: Colors.goldGhost,
  },
  midSection: { flex: 1, flexDirection: "row", alignItems: "center" },
  sideSection: {
    width: SIDE_SECTION_W,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.sm,
  },
  centerSection: { flex: 1, alignItems: "center", justifyContent: "center" },
  handSection: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  handSectionActive: {
    backgroundColor: Colors.goldGhost,
    borderTopWidth: 1,
    // True transparent (alpha 0), not a wash step — useTurnPulse animates this
    // border in from here, so it must start fully invisible, not "barely
    // visible" (goldGhost would show a static hairline while idle).
    borderTopColor: "rgba(201,168,76,0.0)",
  },
});

// ─── useTurnPulse ─────────────────────────────────────────────────────────────

export function useTurnPulse(active: boolean) {
  const glowV = useSharedValue(0);
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (active && reduceMotion) {
      // Same affordance, no breathing: hold the glow at its midpoint.
      cancelAnimation(glowV);
      glowV.value = 0.6;
      return;
    }
    if (active) {
      glowV.value = 0.35;
      glowV.value = withRepeat(
        withSequence(
          withTiming(0.85, { duration: 900 }),
          withTiming(0.35, { duration: 900 })
        ),
        -1,
        false
      );
    } else {
      cancelAnimation(glowV);
      glowV.value = withTiming(0, { duration: Motion.duration.moderate });
    }
    return () => {
      cancelAnimation(glowV);
    };
  }, [active, reduceMotion]);

  // The `rgba(201,168,76,${...})` strings below are per-frame interpolated
  // alphas (borderAlpha ranges continuously 0→0.3), not one of the five fixed
  // gold-alpha steps — a static token can't represent an animated value.
  return useAnimatedStyle(() => {
    const v = glowV.value;
    const shadowRadius = v < 0.01 ? 0 : interpolate(v, [0.35, 0.85], [8, 22], Extrapolation.CLAMP);
    const shadowOpacity = v;
    const elevation = interpolate(v, [0, 0.85], [0, 20], Extrapolation.CLAMP);
    const borderAlpha = interpolate(v, [0, 0.85], [0, 0.3], Extrapolation.CLAMP);

    if (Platform.OS === "web") {
      const blur = v < 0.01 ? 0 : interpolate(v, [0.35, 0.85], [8, 20], Extrapolation.CLAMP);
      const alpha = v < 0.01 ? 0 : interpolate(v, [0.35, 0.85], [0.35, 0.85], Extrapolation.CLAMP);
      return {
        boxShadow: v < 0.01 ? "none" : `0 0 ${blur}px rgba(201,168,76,${alpha})`,
        borderRadius: 14,
        borderTopWidth: 1,
        borderTopColor: `rgba(201,168,76,${borderAlpha})`,
      } as any;
    }

    return {
      shadowColor: Colors.gold,
      shadowOpacity,
      shadowRadius,
      shadowOffset: { width: 0, height: 0 },
      elevation,
      borderTopWidth: 1,
      borderTopColor: `rgba(201,168,76,${borderAlpha})`,
    };
  });
}

// ─── Shared styles ────────────────────────────────────────────────────────────

export const sharedStyles = StyleSheet.create({
  flyingContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 60,
  },
  flyingInner: {
    width: CARD_W * 5,
    height: CARD_H,
    alignItems: "center",
    justifyContent: "center",
  },

  topOppSlot: { alignItems: "center", justifyContent: "center", paddingVertical: 6 },
  topOppRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  topOppAvatarCol: { alignItems: "center", gap: 3 },

  sideOppSlot: { alignItems: "center", justifyContent: "center", gap: 6 },
  sideLeft: { flexDirection: "row" },
  sideRight: { flexDirection: "row-reverse" },
  sideOppAvatarCol: { alignItems: "center", gap: 3, marginHorizontal: 6 },

  oppName: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 10,
    // Between Colors.textMuted (0.58) and Colors.textSecondary (0.75) —
    // neither is an exact match, and only the gold scale is approved for
    // fuzzy snapping, so left inline rather than shift body-text contrast.
    color: "rgba(240,234,214,0.65)",
    maxWidth: 70,
    textAlign: "center",
  },

  avatarOuter: {
    borderWidth: 2,
    // No white-alpha token at this value (Colors.cardBorder is 0.08, a
    // different role and value) — left inline.
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  avatarOuterActive: {
    borderColor: Colors.gold,
    ...Shadow.gold,
  },
  avatarInner: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.goldSoft,
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
    // Near-black but not Colors.bg (off by 1 in the red channel) — no exact
    // token, left inline.
    backgroundColor: "rgba(4,16,8,0.9)",
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
    borderWidth: 1,
    borderColor: Colors.goldStrong,
  },
  countBubbleFinished: {
    backgroundColor: Colors.goldMuted,
    borderColor: Colors.gold,
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
    fontSize: FontSize.xs,
    color: Colors.gold,
  },
  pileStack: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  pilePrevLayer: {
    opacity: 0.35,
    transform: [{ scale: 0.84 }, { translateY: 4 }],
    marginBottom: -CARD_H * 0.14,
  },
  pileCurrentLayer: { opacity: 1 },
  comboLabel: { marginTop: 10 },
  comboChip: {
    backgroundColor: Colors.goldBorder,
    borderRadius: Radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: Colors.goldStrong,
  },
  // Custom "power play" red (bomb/royal straight) — deliberately distinct
  // from Colors.red/redMuted (a different rgb entirely), same rationale as
  // GameTable.tsx's PASS_* constants. No token, left inline.
  comboChipPower: {
    backgroundColor: "rgba(255,80,80,0.22)",
    borderColor: "rgba(255,80,80,0.55)",
  },
  comboChipText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 10,
    color: Colors.gold,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  comboChipTextPower: {
    color: "#FF8888",
  },

  handCenter: {
    alignItems: "center",
    justifyContent: "center",
    height: CARD_H,
    flexDirection: "row",
    gap: 6,
  },
  handGlowWrap: { borderRadius: 14, padding: 4 },
  handGlowWrapActive: {},
  handRow: {
    position: "relative",
    height: CARD_H,
    alignSelf: "center",
  },
  handCardWrap: { position: "absolute", bottom: 0 },
  emptyHandText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 13,
    color: Colors.gold,
  },
});

// ─── getComboLabel ────────────────────────────────────────────────────────────

export function getComboLabel(
  combo: Combination | null,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
): string | null {
  if (!combo) return null;
  const key = COMBO_LABEL_KEYS[combo.type];
  const label = key ? t(key) : combo.type;
  if (combo.cards.length > 2) return `${label}${t("gameShared.comboMultiplier", { count: combo.cards.length })}`;
  return label;
}

// ─── GameBillboard ────────────────────────────────────────────────────────────

export function GameBillboard({
  roundLabel,
  currentComboLabel,
  currentTurnName,
  isLocalPlayerTurn,
}: {
  roundLabel: string;
  currentComboLabel: string | null;
  currentTurnName: string;
  isLocalPlayerTurn: boolean;
}) {
  const { t } = useTranslation();
  const dotOpacity = useSharedValue(0.3);
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (isLocalPlayerTurn && reduceMotion) {
      cancelAnimation(dotOpacity);
      dotOpacity.value = 1;
      return;
    }
    if (isLocalPlayerTurn) {
      dotOpacity.value = withRepeat(
        withSequence(
          withTiming(1.0, { duration: Motion.duration.slow }),
          withTiming(0.3, { duration: Motion.duration.slow })
        ),
        -1,
        false
      );
    } else {
      cancelAnimation(dotOpacity);
      dotOpacity.value = withTiming(0, { duration: Motion.duration.base });
    }
    return () => {
      cancelAnimation(dotOpacity);
    };
  }, [isLocalPlayerTurn, reduceMotion]);

  const dotStyle = useAnimatedStyle(() => ({ opacity: dotOpacity.value }));

  return (
    <View style={billboardStyles.container}>
      <Text style={billboardStyles.comboLabel} numberOfLines={1}>
        {currentComboLabel ?? t("gameShared.emptyTable")}
      </Text>
      <View style={billboardStyles.bottomRow}>
        <Text style={billboardStyles.roundLabel} numberOfLines={1}>{roundLabel}</Text>
        {isLocalPlayerTurn && (
          <Animated.Text style={[billboardStyles.turnDot, dotStyle]}>●</Animated.Text>
        )}
        <Text
          style={[
            billboardStyles.turnLabel,
            isLocalPlayerTurn && billboardStyles.turnLabelActive,
          ]}
          numberOfLines={1}
        >
          {isLocalPlayerTurn ? t("gameShared.yourTurn") : t("gameShared.turnOf", { name: currentTurnName })}
        </Text>
      </View>
    </View>
  );
}

const billboardStyles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    paddingHorizontal: 4,
    gap: 1,
  },
  comboLabel: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.sm,
    color: Colors.gold,
    letterSpacing: 0.5,
    textAlign: "center",
  },
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  roundLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 9,
    color: Colors.textMuted,
  },
  turnDot: {
    fontFamily: "Inter_400Regular",
    fontSize: 8,
    color: Colors.gold,
  },
  turnLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 10,
    color: Colors.textSecondary,
  },
  turnLabelActive: {
    color: Colors.gold,
    fontFamily: "Rajdhani_600SemiBold",
  },
});
