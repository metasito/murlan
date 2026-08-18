import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
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
  cancelAnimation,
  FadeIn,
  FadeOut,
} from "react-native-reanimated";
import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { CardView } from "@/components/CardView";
import { Colors, FontSize, Highlight, Motion, Radius, Scrim, Shadow, Spacing, TABLE_FONT_SCALE_MAX } from "@/lib/theme";
import { useTableFelt } from "@/lib/cosmetics";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import type { Card, Combination, Player, StartReason } from "@/lib/gameEngine";
import { CARD_W, computeHandLayout } from "@/components/handLayout";
import {
  CARD_H,
  FLIGHT_MS,
  HAND_SECTION_H,
  SIDE_SECTION_W,
  type FlyDirection,
} from "@/components/gameTableModel";
import { a11yHidden } from "@/lib/a11y";

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
// How high the throw arcs and how far it drives into the felt before rocking
// back. The flight's duration lives in gameTableModel, because the table times
// its impact sound and shake against it.
const ARC_PEAK = 22;
const LAND_DIP = 5;

// ─── Table vignette ───────────────────────────────────────────────────────────

// Four edge washes plus four diagonal corner washes. The corners are the half
// that makes it read as a lit table rather than as four dark stripes: without
// them the corner is only as dark as one edge, so the darkest region of the
// felt ends up on the edge midpoints instead of the extremities.
export function TableVignette() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient
        colors={[Scrim.medium, "transparent"]}
        style={vignetteStyles.top}
        pointerEvents="none"
      />
      <LinearGradient
        colors={["transparent", Scrim.heavy]}
        style={vignetteStyles.bottom}
        pointerEvents="none"
      />
      <LinearGradient
        colors={[Scrim.medium, "transparent"]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={vignetteStyles.left}
        pointerEvents="none"
      />
      <LinearGradient
        colors={["transparent", Scrim.medium]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={vignetteStyles.right}
        pointerEvents="none"
      />
    </View>
  );
}

// Four bands, each spanning a full edge and reaching transparent inside the
// felt. A corner piece cannot: a diagonal gradient over a box only reaches
// transparent at the box's opposite corner, so it still carries ink along the
// two edges that face the middle of the table and draws them as hard lines
// across the felt. The corners are darkened by the bands overlapping instead.
const vignetteStyles = StyleSheet.create({
  top:    { position: "absolute", top: 0, left: 0, right: 0, height: "22%" },
  bottom: { position: "absolute", bottom: 0, left: 0, right: 0, height: "26%" },
  left:   { position: "absolute", top: 0, bottom: 0, left: 0, width: "16%" },
  right:  { position: "absolute", top: 0, bottom: 0, right: 0, width: "16%" },
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
  // The avatar itself never scales: it contains the initials, and React Native
  // rasterises text before transforming it, so a scaled avatar is a blurred
  // avatar. The turn signal is carried entirely by two textless sibling rings —
  // a steady one that fades in, and a one-shot ping that expands and vanishes.
  const ringOpacity = useSharedValue(0);
  const pingScale = useSharedValue(1);
  const pingOpacity = useSharedValue(0);
  const reduceMotion = usePrefersReducedMotion();
  // The avatar sits on the felt, so it takes the felt's colour: a green bubble
  // on a bordeaux table reads as an oversight rather than a choice.
  const felt = useTableFelt();

  useEffect(() => {
    ringOpacity.value = withTiming(isActive ? 1 : 0, {
      duration: reduceMotion ? 0 : Motion.duration.base,
    });
    if (!isActive || reduceMotion) return;
    pingScale.value = 1;
    pingOpacity.value = 0.9;
    pingScale.value = withTiming(1.75, { duration: Motion.duration.slow, easing: Easing.out(Easing.cubic) });
    pingOpacity.value = withTiming(0, { duration: Motion.duration.slow, easing: Easing.out(Easing.quad) });
  }, [isActive, reduceMotion, ringOpacity, pingScale, pingOpacity]);

  useEffect(
    () => () => {
      cancelAnimation(ringOpacity);
      cancelAnimation(pingScale);
      cancelAnimation(pingOpacity);
    },
    [ringOpacity, pingScale, pingOpacity]
  );

  const ringStyle = useAnimatedStyle(() => ({ opacity: ringOpacity.value }));
  const pingStyle = useAnimatedStyle(() => ({
    opacity: pingOpacity.value,
    transform: [{ scale: pingScale.value }],
  }));
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const outerSize = size + 6;
  return (
    <View>
      <Animated.View
        pointerEvents="none"
        style={[
          sharedStyles.avatarPing,
          { width: outerSize, height: outerSize, borderRadius: outerSize / 2 },
          pingStyle,
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          sharedStyles.avatarRing,
          { width: outerSize, height: outerSize, borderRadius: outerSize / 2 },
          ringStyle,
        ]}
      />
      <View
        style={[
          sharedStyles.avatarOuter,
          { width: outerSize, height: outerSize, borderRadius: outerSize / 2 },
        ]}
      >
        <LinearGradient
          colors={[felt[1], felt[3]]}
          style={[
            sharedStyles.avatarInner,
            { width: size, height: size, borderRadius: size / 2 },
          ]}
        >
          <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={[sharedStyles.avatarInitials, { fontSize: size * 0.36 }]}>
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
            <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={sharedStyles.countBubbleText}>{cardCount}</Text>
          )}
        </View>
      </View>
    </View>
  );
}

// ─── BotSeatBadge ─────────────────────────────────────────────────────────────

// Persistent marker for a seat currently played by the computer — a vacated
// human seat and one dealt in as AI from the start render identically, on
// purpose: the name already carries who the seat used to be. Unlike the
// one-shot `game:seat_bot_takeover` banner, this renders for as long as
// `player.type === "ai"` holds.
function BotSeatBadge() {
  const { t } = useTranslation();
  return (
    <View style={sharedStyles.botBadge}>
      <Ionicons
        name="hardware-chip-outline"
        size={FontSize.xs}
        color={Colors.gold}
        {...a11yHidden()}
      />
      <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={sharedStyles.botBadgeText}>{t("onlineGame.botSeatLabel")}</Text>
    </View>
  );
}

// ─── SeatBadges ───────────────────────────────────────────────────────────────

// A pass leaves no trace on the felt, so this chip is the only thing that says
// a seat is out of the current round. It stands until somebody plays, which is
// when `passedSeats` (gameTableModel.ts) stops returning that seat. Deliberately
// quieter than the gold bot badge and the gold turn ring: a seat that has
// withdrawn from the round must not out-shout whose turn it is.
function PassedChip() {
  const { t } = useTranslation();
  return (
    <View style={sharedStyles.passedChip}>
      <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={sharedStyles.passedChipText}>{t("gameShared.passedLabel")}</Text>
    </View>
  );
}

// Both markers share one wrapping row. A seat carrying both would otherwise add
// two badge heights to a column laid out inside the fixed TOP_SECTION_H.
function SeatBadges({ passed, isBot }: { passed: boolean; isBot: boolean }) {
  if (!passed && !isBot) return null;
  return (
    <View style={sharedStyles.seatBadgeRow}>
      {passed && <PassedChip />}
      {isBot && <BotSeatBadge />}
    </View>
  );
}

// ─── TopOppSlot ───────────────────────────────────────────────────────────────

export function TopOppSlot({
  player,
  isActive,
  cardCount,
  passed = false,
}: {
  player: Player;
  isActive: boolean;
  cardCount?: number;
  /** This seat has passed in the round on the table. */
  passed?: boolean;
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
          <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={sharedStyles.oppName} numberOfLines={1}>
            {player.name}
          </Text>
          <SeatBadges passed={passed} isBot={player.type === "ai"} />
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
  passed = false,
}: {
  player: Player;
  isActive: boolean;
  side: "left" | "right";
  cardCount?: number;
  /** This seat has passed in the round on the table. */
  passed?: boolean;
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
        <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={sharedStyles.oppName} numberOfLines={1}>
          {player.name}
        </Text>
        <SeatBadges passed={passed} isBot={player.type === "ai"} />
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
  const reduceMotion = usePrefersReducedMotion();

  // The caller passes a fresh onDone closure on every render; a ref keeps the
  // flight effect below from restarting mid-flight when that happens. The ref
  // is written after commit, never during render — the only reader is a timer
  // or an animation callback, both of which fire later.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });
  // Defined on the JS thread so runOnJS receives a real JS-thread reference.
  const notifyDone = useCallback(() => onDoneRef.current(), []);

  const tx = useSharedValue(dx);
  const ty = useSharedValue(dy);
  const rot = useSharedValue(startRot);
  const opacity = useSharedValue(0);
  // Parabolic arc — peak at mid-flight, then land
  const arcY = useSharedValue(0);
  // Overshoot past the pile and rock back, so the card lands with weight
  // instead of stopping dead on its mark.
  const settle = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      // The pile is about to show these cards anyway; skip the flight entirely
      // and hand control straight back rather than jumping them across.
      const id = setTimeout(() => onDoneRef.current(), Motion.duration.fast);
      return () => clearTimeout(id);
    }
    const easing = Easing.bezier(0.22, 0.61, 0.36, 1.0);

    opacity.value = withTiming(1, { duration: Motion.duration.flash * 0.7 });
    tx.value = withTiming(0, { duration: FLIGHT_MS, easing });
    ty.value = withTiming(0, { duration: FLIGHT_MS, easing });
    rot.value = withTiming(landingRot, { duration: FLIGHT_MS, easing: Easing.out(Easing.cubic) });
    arcY.value = withSequence(
      withTiming(-ARC_PEAK, { duration: FLIGHT_MS * 0.5, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: FLIGHT_MS * 0.5, easing: Easing.in(Easing.quad) })
    );
    settle.value = withDelay(
      FLIGHT_MS * 0.82,
      withSequence(
        withTiming(1, { duration: Motion.duration.flash }),
        withSpring(0, Motion.spring.land, (finished) => {
          if (finished) runOnJS(notifyDone)();
        })
      )
    );

    return () => {
      cancelAnimation(tx);
      cancelAnimation(ty);
      cancelAnimation(rot);
      cancelAnimation(opacity);
      cancelAnimation(arcY);
      cancelAnimation(settle);
    };
    // Every entry is stable for the life of one flight — the caller remounts
    // this component via `key` for each new one — so this runs once per flight.
  }, [reduceMotion, landingRot, notifyDone, tx, ty, rot, opacity, arcY, settle]);

  const aStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value + arcY.value + settle.value * LAND_DIP },
      { rotate: `${rot.value + settle.value * landingRot * 0.4}deg` },
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

// Cards thrown onto a table do not land square. Each one gets a small fixed
// tilt derived from its own id, so the pile looks handled rather than stacked
// — and so the same combination always looks the same, on every client.
const PILE_MAX_TILT = 4.5;
function tiltOf(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return ((Math.abs(hash) % 200) / 100 - 1) * PILE_MAX_TILT;
}

function PileComboCards({ cards }: { cards: Card[] }) {
  const overlap = cards.length > 8 ? 9 : cards.length > 5 ? 12 : 14;
  const totalW = overlap * (cards.length - 1) + CARD_W;
  return (
    <View style={{ width: totalW, height: CARD_H, position: "relative" }}>
      {cards.map((card, ci) => (
        <View
          key={card.id}
          style={{
            position: "absolute",
            left: ci * overlap,
            zIndex: ci,
            transform: [{ rotate: `${tiltOf(card.id)}deg` }],
          }}
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
  const reduceMotion = usePrefersReducedMotion();
  // The pile settles downward rather than scaling up: it holds card faces and
  // a label, and scaling rasterised text is what makes it look cheap.
  const settleY = useSharedValue(0);

  useEffect(() => {
    if (!bounceTrigger || reduceMotion) return;
    settleY.value = withSequence(
      withTiming(-5, { duration: Motion.duration.flash }),
      withSpring(0, Motion.spring.land)
    );
  }, [bounceTrigger, reduceMotion, settleY]);

  useEffect(
    () => () => {
      cancelAnimation(settleY);
    },
    [settleY]
  );

  const bounceStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: settleY.value }],
  }));

  const isPower = current && POWER_COMBOS.has(current.type);

  return (
    <Animated.View style={[sharedStyles.pileArea, bounceStyle]} testID="pile-area">
      {roundWinner && (
        <Animated.View
          entering={reduceMotion ? undefined : FadeIn.duration(250)}
          exiting={reduceMotion ? undefined : FadeOut.duration(250)}
          style={sharedStyles.winnerTag}
        >
          <Ionicons name="star" size={9} color={Colors.gold} />
          <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={sharedStyles.winnerText}>{roundWinner}</Text>
        </Animated.View>
      )}

      <View style={sharedStyles.pileStack}>
        {/* The beaten combination stays under the new one, rotated off-axis,
            the way the previous trick sits under the one that took it. */}
        {prev && (
          <View style={sharedStyles.pilePrevLayer} pointerEvents="none">
            <PileComboCards cards={prev.cards} />
          </View>
        )}
        {current && <PileComboCards cards={current.cards} />}
      </View>

      {current && (
        <View style={sharedStyles.comboLabel}>
          <View style={[sharedStyles.comboChip, isPower && sharedStyles.comboChipPower]}>
            <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={[sharedStyles.comboChipText, isPower && sharedStyles.comboChipTextPower]}>
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
// How far a selected card rises out of the fan, and how far it tips as it is
// picked up. The rotation is what stops the lift reading as a flat slide.
const SELECT_LIFT = -16;
const SELECT_TILT = -3;
// Where a dealt card comes from: up and in, i.e. the middle of the table.
const DEAL_RISE = -CARD_H * 2.2;
const DEAL_TILT = 14;

interface CardItemProps {
  card: Card;
  isSelected: boolean;
  left: number;
  onPress: (id: string) => void;
  disabled: boolean;
  zIndex: number;
  /** Draw the back — the hand belongs to someone else. */
  faceDown?: boolean;
  /** ms to wait before this card flies in, or -1 for no deal animation. */
  dealDelay: number;
  /** Horizontal distance back to the deck, so the fan converges on one point. */
  dealFromX: number;
}

function CardItemBase({
  card,
  isSelected,
  left,
  onPress,
  disabled,
  zIndex,
  dealDelay,
  dealFromX,
  faceDown = false,
}: CardItemProps) {
  const reduceMotion = usePrefersReducedMotion();
  const liftY = useSharedValue(0);
  const tilt = useSharedValue(0);
  const glow = useSharedValue(0);
  const dealing = useSharedValue(dealDelay >= 0 && !reduceMotion ? 1 : 0);
  // The stagger is disarmed one render after the hand appears, so `dealDelay`
  // becomes -1 while this card is still flying in. The deal owes its timing to
  // the value the card mounted with.
  const dealDelayRef = useRef(dealDelay);

  useEffect(() => {
    if (dealing.value === 0) return;
    dealing.value = withDelay(
      dealDelayRef.current,
      withSpring(0, Motion.spring.land)
    );
  }, [dealing]);

  useEffect(() => {
    if (reduceMotion) {
      liftY.value = withTiming(isSelected ? SELECT_LIFT : 0, { duration: Motion.duration.fast });
      tilt.value = 0;
      glow.value = withTiming(isSelected ? 1 : 0, { duration: Motion.duration.fast });
      return;
    }
    liftY.value = withSpring(isSelected ? SELECT_LIFT : 0, Motion.spring.pickup);
    tilt.value = withSpring(isSelected ? SELECT_TILT : 0, Motion.spring.pickup);
    glow.value = withTiming(isSelected ? 1 : 0, { duration: Motion.duration.fast });
  }, [isSelected, reduceMotion, liftY, tilt, glow]);

  useEffect(
    () => () => {
      cancelAnimation(liftY);
      cancelAnimation(tilt);
      cancelAnimation(glow);
      cancelAnimation(dealing);
    },
    [liftY, tilt, glow, dealing]
  );

  const aStyle = useAnimatedStyle(() => {
    const d = dealing.value;
    return {
      opacity: 1 - d,
      transform: [
        { translateX: dealFromX * d },
        { translateY: liftY.value + DEAL_RISE * d },
        { rotate: `${tilt.value + DEAL_TILT * d}deg` },
      ],
    };
  });

  // A textless sibling behind the card carries the selection bloom, so the
  // glow can be animated with opacity alone and never touches the card's own
  // rasterised rank characters.
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  const cardId = card.id;
  const handlePress = useCallback(() => onPress(cardId), [onPress, cardId]);

  return (
    <Animated.View
      style={[sharedStyles.handCardWrap, { left, zIndex }, aStyle]}
    >
      <Animated.View pointerEvents="none" style={[sharedStyles.cardGlow, glowStyle]} />
      <CardView
        card={card}
        selected={isSelected}
        onPress={handlePress}
        disabled={disabled}
        faceDown={faceDown}
        noLift
      />
    </Animated.View>
  );
}

/**
 * Compares the card by id for the same reason CardView does: an incoming
 * `game:state` rebuilds every card object, and `dealDelay` is deliberately
 * excluded because the deal reads it once at mount (`dealDelayRef`), so a
 * later change to it must not remount the card mid-flight.
 */
function cardItemPropsEqual(a: CardItemProps, b: CardItemProps): boolean {
  return (
    a.card.id === b.card.id &&
    a.isSelected === b.isSelected &&
    a.left === b.left &&
    a.onPress === b.onPress &&
    a.disabled === b.disabled &&
    a.zIndex === b.zIndex &&
    a.faceDown === b.faceDown &&
    a.dealFromX === b.dealFromX
  );
}

export const CardItem = React.memo(CardItemBase, cardItemPropsEqual);
CardItem.displayName = "CardItem";

// ─── StraightHand ─────────────────────────────────────────────────────────────

export function StraightHand({
  cards,
  selectedIds,
  onPress,
  disabled,
  availW,
  isMyTurn,
  faceDown = false,
}: {
  cards: Card[];
  selectedIds: string[];
  onPress: (id: string) => void;
  disabled: boolean;
  availW: number;
  isMyTurn?: boolean;
  /** Draw backs instead of faces — the hand belongs to someone else. */
  faceDown?: boolean;
}) {
  const { t } = useTranslation();
  const n = cards.length;
  // O(1) membership check per card instead of `selectedIds.includes(card.id)`
  // (an O(k) scan repeated for every one of the up to 27 cards in a hand).
  // Computed before the early return below — Rules of Hooks requires every
  // hook to run unconditionally on every render of this component.
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Armed while the hand is empty, so the render on which a hand appears —
  // the start of a game, or of the next one after a rematch — is the render
  // whose cards mount staggered. A single card arriving later (the exchange
  // give-back) mounts with the deal disarmed and simply appears in place.
  const [dealArmed, setDealArmed] = useState(true);
  useEffect(() => {
    setDealArmed(n === 0);
  }, [n]);

  if (n === 0) {
    return (
      <View style={[sharedStyles.handCenter, { width: availW }]}>
        <Ionicons name="checkmark-circle" size={24} color={Colors.gold} />
        <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={sharedStyles.emptyHandText}>{t("gameShared.emptyHand")}</Text>
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
          faceDown={faceDown}
          zIndex={i}
          dealDelay={dealArmed ? i * Motion.stagger.deal : -1}
          dealFromX={totalW / 2 - i * step - CARD_W / 2}
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
  players: { name: string; type: string }[];
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
        backgroundColor: Colors.overlayStrong,
        borderColor: Colors.gold,
        borderWidth: 1,
        borderRadius: Radius.lg,
        paddingHorizontal: 18,
        paddingVertical: Spacing.sm,
        alignItems: "center",
        maxWidth: 420,
        gap: 2,
      }}>
        <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={{ fontFamily: "Rajdhani_600SemiBold", fontSize: 14, color: Colors.gold, letterSpacing: 0.5, textAlign: "center" }}>
          {mainText}
        </Text>
        {subText ? (
          <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={{ fontFamily: "Inter_400Regular", fontSize: FontSize.xs, color: Colors.textSecondary, textAlign: "center" }}>
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
    backgroundColor: Colors.overlayOpaque,
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
    borderBottomColor: Colors.goldGhost,
  },
  midSection: { flex: 1, flexDirection: "row", alignItems: "center" },
  // A side seat's fan is wider than SIDE_SECTION_W and is meant to be: it
  // leans in over the felt, the way a real player's hand does. Anchoring each
  // section to the table's outer edge is what keeps that overflow pointing
  // inward — centred, half of it lands off the side of the screen and takes
  // the avatar with it.
  sideSection: {
    width: SIDE_SECTION_W,
    justifyContent: "center",
    paddingHorizontal: Spacing.sm,
  },
  sideSectionLeft: { alignItems: "flex-start" },
  sideSectionRight: { alignItems: "flex-end" },
  centerSection: { flex: 1, alignItems: "center", justifyContent: "center" },
  handSection: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  handSectionActive: {
    backgroundColor: Colors.goldGhost,
  },
  // The turn pulse, as a textless childless sibling behind the hand: the glow
  // and the hairline along the top edge are fixed, and useTurnPulse animates
  // only this view's opacity. The wash and the hairline are what the shadow is
  // cast from — a layer with transparent contents has nothing for iOS to blur
  // and gives Android's elevation no outline.
  handGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: Radius.md,
    borderTopWidth: 1,
    borderTopColor: Colors.goldStrong,
    backgroundColor: Colors.goldGhost,
    ...Shadow.goldSoft,
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
  }, [active, reduceMotion, glowV]);

  // Opacity only. The glow and the gold hairline are static, on the childless
  // sibling the caller puts behind the hand (`sharedTableStyles.handGlow`):
  // a shadow or a border colour written per frame is paint the browser cannot
  // composite, and on web reanimated writes it from the main JS thread.
  return useAnimatedStyle(() => ({ opacity: glowV.value }));
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

  // The same plate the count bubble already uses. On the raw felt the name
  // measures 3.43:1 at the top of the gradient, which is where the top seat
  // renders.
  oppName: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 10,
    color: Colors.textMuted,
    maxWidth: 70,
    textAlign: "center",
    backgroundColor: Colors.overlayStrong,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.xs,
    overflow: "hidden",
  },

  // Wraps rather than growing, because the column it sits in has no room to
  // spare below the avatar and the name.
  seatBadgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: Spacing.xs,
  },
  // Neutral, not red: red is the PASSA control and the bomb, and this is
  // neither a control nor a dramatic play — it is a seat that has receded.
  passedChip: {
    paddingHorizontal: Spacing.xs,
    borderRadius: Radius.sm,
    backgroundColor: Scrim.medium,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
  },
  passedChipText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    letterSpacing: 1,
  },

  botBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.xs,
    borderRadius: Radius.sm,
    backgroundColor: Scrim.heavy,
    borderWidth: 1,
    borderColor: Colors.goldBorder,
  },
  botBadgeText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: FontSize.xs,
    color: Colors.gold,
  },

  avatarOuter: {
    borderWidth: 2,
    borderColor: Highlight.clear,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  avatarRing: {
    position: "absolute",
    borderWidth: 2,
    borderColor: Colors.gold,
    ...Shadow.gold,
  },
  avatarPing: {
    position: "absolute",
    borderWidth: 1.5,
    borderColor: Colors.goldStrong,
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
    backgroundColor: Colors.overlayStrong,
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
  // An opaque-enough dark plate, not a gold wash: gold on gold over the felt
  // measures 2.49-4.31:1 depending on where the gradient is under it. The
  // border is where the chip's identity lives.
  winnerTag: {
    position: "absolute",
    top: -28,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Scrim.heavy,
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
    position: "absolute",
    opacity: 0.3,
    transform: [{ rotate: "-7deg" }, { translateY: 9 }],
  },
  comboLabel: { marginTop: 10 },
  comboChip: {
    backgroundColor: Scrim.heavy,
    borderRadius: Radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: Colors.goldStrong,
  },
  comboChipPower: {
    borderColor: Colors.bombBorder,
  },
  comboChipText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 10,
    color: Colors.gold,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  comboChipTextPower: {
    color: Colors.bombText,
  },

  handCenter: {
    alignItems: "center",
    justifyContent: "center",
    height: CARD_H,
    flexDirection: "row",
    gap: 6,
  },
  handGlowWrap: { borderRadius: 14, padding: 4 },
  handGlowWrapActive: { backgroundColor: Colors.goldGhost },
  cardGlow: {
    position: "absolute",
    top: 2, left: 2, right: 2, bottom: 2,
    borderRadius: Radius.sm,
    backgroundColor: Colors.gold,
    ...Shadow.goldSoft,
  },
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
  }, [isLocalPlayerTurn, reduceMotion, dotOpacity]);

  const dotStyle = useAnimatedStyle(() => ({ opacity: dotOpacity.value }));

  return (
    <View style={billboardStyles.container}>
      <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={billboardStyles.comboLabel} numberOfLines={1}>
        {currentComboLabel ?? t("gameShared.emptyTable")}
      </Text>
      <View style={billboardStyles.bottomRow}>
        <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={billboardStyles.roundLabel} numberOfLines={1}>{roundLabel}</Text>
        {isLocalPlayerTurn && (
          <Animated.Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={[billboardStyles.turnDot, dotStyle]}>●</Animated.Text>
        )}
        <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX}
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
