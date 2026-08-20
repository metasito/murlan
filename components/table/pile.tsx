import { useCallback, useEffect, useRef } from "react";
import { View, Text, StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  withSequence,
  withDelay,
  Easing,
  cancelAnimation,
  FadeIn,
  FadeOut,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import Ionicons from "@expo/vector-icons/Ionicons";
import { CardView } from "@/components/CardView";
import { Colors, FontSize, Motion, Radius, Scrim, Spacing, TABLE_FONT_SCALE_MAX } from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import type { Card, Combination } from "@/lib/gameEngine";
import { CARD_W } from "@/components/handLayout";
import {
  CARD_H,
  FLIGHT_MS,
  LANDING_FRACTION,
  cardTilt,
  fanCenterOffset,
  fanOffsets,
  type FlyDirection,
} from "@/components/gameTableModel";

const FLY_OFFSETS: Record<FlyDirection, { dx: number; dy: number }> = {
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
  // Defined on the JS thread so scheduleOnRN receives a real JS-thread reference.
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
      FLIGHT_MS * LANDING_FRACTION,
      withSequence(
        withTiming(1, { duration: Motion.duration.flash }),
        withSpring(0, Motion.spring.land, (finished) => {
          if (finished) scheduleOnRN(notifyDone);
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
  const { step, angle, totalW } = fanOffsets(display.length, "combo");

  return (
    <View style={[pileStyles.flyingContainer, { pointerEvents: "none" as const }]}>
      <Animated.View style={[pileStyles.flyingInner, aStyle]}>
        {display.map((card, i) => (
          <View
            key={card.id}
            style={{
              position: "absolute",
              left: fanCenterOffset(i, step, totalW),
              zIndex: i,
              transform: [{ rotate: `${cardTilt(card.id, angle)}deg` }],
            }}
          >
            <CardView card={card} />
          </View>
        ))}
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
  const { step, angle, totalW } = fanOffsets(cards.length, "combo");
  return (
    <View style={{ width: totalW, height: CARD_H, position: "relative" }}>
      {cards.map((card, ci) => (
        <View
          key={card.id}
          style={{
            position: "absolute",
            left: ci * step,
            zIndex: ci,
            transform: [{ rotate: `${cardTilt(card.id, angle)}deg` }],
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
    <Animated.View style={[pileStyles.pileArea, bounceStyle]} testID="pile-area">
      {roundWinner && (
        <Animated.View
          entering={reduceMotion ? undefined : FadeIn.duration(250)}
          exiting={reduceMotion ? undefined : FadeOut.duration(250)}
          style={pileStyles.winnerTag}
        >
          <Ionicons name="star" size={9} color={Colors.gold} />
          <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={pileStyles.winnerText}>{roundWinner}</Text>
        </Animated.View>
      )}

      <View style={pileStyles.pileStack}>
        {/* The beaten combination stays under the new one, rotated off-axis,
            the way the previous trick sits under the one that took it. */}
        {prev && (
          <View style={pileStyles.pilePrevLayer} pointerEvents="none">
            <PileComboCards cards={prev.cards} />
          </View>
        )}
        {current && <PileComboCards cards={current.cards} />}
      </View>

      {current && (
        <View style={pileStyles.comboLabel}>
          <View style={[pileStyles.comboChip, isPower && pileStyles.comboChipPower]}>
            <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={[pileStyles.comboChipText, isPower && pileStyles.comboChipTextPower]}>
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

// ─── Styles ───────────────────────────────────────────────────────────────────

const pileStyles = StyleSheet.create({
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
  pileArea: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 80,
  },
  // A dark plate, not a gold wash: gold on gold over the felt clears AA at no
  // stop of any felt. The border is where the chip's identity lives.
  winnerTag: {
    position: "absolute",
    top: -28,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    backgroundColor: Scrim.heavy,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.snug,
    paddingVertical: Spacing.xs,
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
  comboLabel: { marginTop: Spacing.snug },
  comboChip: {
    backgroundColor: Scrim.heavy,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.snug,
    paddingVertical: Spacing.xxs,
    borderWidth: 1,
    borderColor: Colors.goldStrong,
  },
  comboChipPower: {
    borderColor: Colors.bombBorder,
  },
  comboChipText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.xxs,
    color: Colors.gold,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  comboChipTextPower: {
    color: Colors.bombText,
  },
});
