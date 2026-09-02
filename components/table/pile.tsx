import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { View, StyleSheet } from "react-native";
import { TableText } from "./TableText";
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
import { Colors, FontSize, Hold, Motion, Radius, Scrim, Shadow, Spacing, Layer } from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import type { Card, Combination } from "@/lib/gameEngine";
import { CARD_W, CARD_H, FIELD_SCALE } from "@/components/cardFaceModel";
import {
  COMBO_MAX_TILT,
  FLIGHT_MS,
  cardTilt,
  flinchFor,
  impactDelayMs,
  landingHoldMs,
  landSquashScale,
  settleForMotion,
  type FlyDirection,
  type ImpactTier,
} from "@/components/gameTableModel";
import { FIELD_ARC, solveArc } from "@/components/tableArc";

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
/**
 * The longest a flight may hold the felt. The throw is `FLIGHT_MS`, the table
 * holds still, and the landing settles for a spring after that; this is well
 * past all three, so it never cuts a flight that is running — it only ends one
 * that has stopped reporting. The hold is a term rather than slack it happens
 * to fit inside: a longer hold pushes the settle later, and a floor that fired
 * first would run `onDone` twice.
 */
const FLIGHT_LIMIT_MS = FLIGHT_MS * 3 + Hold.land;

/**
 * Where a combination's cards sit on the felt. A combination mid-throw and the
 * same combination the frame after it lands are one call, so it cannot shift
 * as it arrives.
 */
function fieldArc(cards: Card[], cardScale: number, roomW: number) {
  const cardW = CARD_W(cardScale);
  const cardH = CARD_H(cardScale);
  const { cards: arc, box } = solveArc(cards.length, {
    budget: FIELD_ARC,
    cardW,
    cardH,
    scale: cardScale,
    room: roomW,
  });
  return { arc, box, cardH };
}

// ─── FlyingCards ──────────────────────────────────────────────────────────────

export function FlyingCards({
  cards,
  direction,
  origin,
  onDone,
  roomW,
  scale = 1,
}: {
  cards: Card[];
  direction: FlyDirection;
  /** Where the throw starts — components/gameTableModel.ts `flightOrigin`. */
  origin: { dx: number; dy: number };
  onDone: () => void;
  /** The width share the field's arc may take — see FIELD_WIDTH_SHARE. */
  roomW: number;
  /** The table's own scale — the pile draws its cards at `scale * FIELD_SCALE`. */
  scale?: number;
}) {
  const { dx, dy } = origin;
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
    // Runs on every entry to this effect, including a toggle mid-flight —
    // see settleForMotion for why that matters.
    settle.value = settleForMotion(reduceMotion, settle.value);
    if (reduceMotion) {
      // The pile is about to show these cards anyway; skip the flight entirely
      // and hand control straight back rather than jumping them across.
      const id = setTimeout(() => onDoneRef.current(), Motion.duration.tap);
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
    // The card is down at `impactDelayMs()`, then the table sits still for the
    // hold before the settle — and the pile bounce riding its callback — runs.
    settle.value = withDelay(
      impactDelayMs(reduceMotion) + landingHoldMs(reduceMotion),
      withSequence(
        withTiming(1, { duration: Motion.duration.flash }),
        withSpring(0, Motion.spring.land, (finished) => {
          if (finished) scheduleOnRN(notifyDone);
        })
      )
    );

    // The floor under that callback. While a flight is up the pile draws
    // nothing — the cards in the air are the cards on the felt — so a flight
    // that never reports itself finished leaves the middle of the table empty
    // for the rest of the round. `finished` is false for any interruption, and
    // a spring that is cancelled or never scheduled reports nothing at all, so
    // the landing cannot be the only way out.
    const floor = setTimeout(() => onDoneRef.current(), FLIGHT_LIMIT_MS);

    return () => {
      clearTimeout(floor);
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

  const aStyle = useAnimatedStyle(() => {
    const squash = landSquashScale(settle.value);
    return {
      transform: [
        { translateX: tx.value },
        { translateY: ty.value + arcY.value + settle.value * LAND_DIP },
        { rotate: `${rot.value + settle.value * landingRot * 0.4}deg` },
        { scaleX: squash.x },
        { scaleY: squash.y },
      ],
      opacity: opacity.value,
    };
  });

  const cardScale = scale * FIELD_SCALE;
  const { arc, box, cardH } = fieldArc(cards, cardScale, roomW);

  return (
    <View style={[pileStyles.flyingContainer, { pointerEvents: "none" as const }]}>
      <Animated.View
        testID="flying-cards"
        style={[pileStyles.flyingInner, { width: box.w, height: box.h }, aStyle]}
      >
        {arc.map((place, i) => (
          <View
            key={cards[i].id}
            style={{
              position: "absolute",
              left: box.w / 2 + place.x,
              top: place.y + (box.h - cardH),
              zIndex: i,
              transform: [
                { rotate: `${place.rot + cardTilt(cards[i].id, COMBO_MAX_TILT)}deg` },
              ],
            }}
          >
            <CardView card={cards[i]} scale={cardScale} light="flat" />
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

// The flush's "catch": a hand-emptying play's own cards bloom gold and lift,
// same 620ms every time — verbatim off the prototype's `catch` keyframe.
// Two segments (0-50%, 50-100%), each ease-out, rather than one duration
// straight through: the bloom and lift both peak at the midpoint and return,
// not ramp continuously to it.
const CATCH_MS = 620;
const CATCH_LIFT = -9;
const CATCH_EASING = Easing.out(Easing.cubic);

function CatchCard({
  trigger,
  scale,
  children,
}: {
  trigger: number;
  scale: number;
  children: ReactNode;
}) {
  const reduceMotion = usePrefersReducedMotion();
  const glow = useSharedValue(0);
  // 0 at rest, 1 at the top of the lift — the table's own scale multiplies it
  // at render, so resizing the table cannot read as a fresh catch.
  const lift = useSharedValue(0);

  useEffect(() => {
    if (!trigger || reduceMotion) return;
    glow.value = 0;
    lift.value = 0;
    const half = CATCH_MS / 2;
    // One descriptor per shared value: Reanimated mutates an animation as it
    // runs, so two values cannot share one.
    const bloom = () =>
      withSequence(
        withTiming(1, { duration: half, easing: CATCH_EASING }),
        withTiming(0, { duration: half, easing: CATCH_EASING })
      );
    glow.value = bloom();
    lift.value = bloom();
  }, [trigger, reduceMotion, glow, lift]);

  useEffect(
    () => () => {
      cancelAnimation(glow);
      cancelAnimation(lift);
    },
    [glow, lift]
  );

  const liftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: lift.value * CATCH_LIFT * scale }],
  }));
  // Opacity only, on a childless sibling behind the card — the same
  // compositor-safe substitute for an animated shadow hand.tsx's cardGlow uses.
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  return (
    <Animated.View style={liftStyle}>
      <Animated.View pointerEvents="none" style={[pileStyles.catchGlow, glowStyle]} />
      <View style={pileStyles.caughtCard}>{children}</View>
    </Animated.View>
  );
}

function PileComboCards({
  cards,
  scale,
  roomW,
  catchTrigger,
}: {
  cards: Card[];
  scale: number;
  roomW: number;
  /** Runs `catch` on every card here when it changes — omit for a layer that never should (the beaten `prev` combination). */
  catchTrigger?: number;
}) {
  const { arc, box, cardH } = fieldArc(cards, scale, roomW);
  return (
    <View style={{ width: box.w, height: box.h, position: "relative" }}>
      {arc.map((place, i) => {
        const face = <CardView card={cards[i]} scale={scale} light="flat" />;
        return (
          <View
            key={cards[i].id}
            style={{
              position: "absolute",
              left: box.w / 2 + place.x,
              top: place.y + (box.h - cardH),
              zIndex: i,
              transform: [
                { rotate: `${place.rot + cardTilt(cards[i].id, COMBO_MAX_TILT)}deg` },
              ],
            }}
          >
            {catchTrigger !== undefined ? (
              <CatchCard trigger={catchTrigger} scale={scale}>
                {face}
              </CatchCard>
            ) : (
              face
            )}
          </View>
        );
      })}
    </View>
  );
}

// The beaten pile's resting pose, folded into `prevLayerStyle` below rather
// than left in `pilePrevLayer`'s own static style — the flinch (#764) rides
// the same worklet, so a second `transform` array cannot clobber it (React
// Native replaces a style's `transform` wholesale, never merges it).
const PILE_PREV_ROTATE_DEG = -7;
const PILE_PREV_Y = 9;

export function PlayedPile({
  prev,
  current,
  roundWinner,
  bounceTrigger,
  catchTrigger,
  flinchTrigger,
  flinchTier,
  roomW,
  scale = 1,
}: {
  prev: Combination | null;
  current: Combination | null;
  roundWinner: string | null;
  bounceTrigger?: number;
  /** The flush: the play just landed emptied a hand. */
  catchTrigger?: number;
  /** Increments at the same `impactDelayMs()` landing everything else on the table reads — the beaten pile's own reaction to being displaced (#764). */
  flinchTrigger?: number;
  /** The tier `flinchTrigger`'s landing resolved to — gameTableModel.ts `flinchFor`. */
  flinchTier?: ImpactTier;
  /** The width share the field's arc may take — see FIELD_WIDTH_SHARE. */
  roomW: number;
  /** The table's own scale — the pile draws its cards at `scale * FIELD_SCALE`. */
  scale?: number;
}) {
  const { t } = useTranslation();
  const cardScale = scale * FIELD_SCALE;
  const reduceMotion = usePrefersReducedMotion();
  // The pile settles downward rather than scaling up: it holds card faces and
  // a label, and scaling rasterised text is what makes it look cheap.
  const settleY = useSharedValue(0);
  // The beaten combination's own reaction (#764): knocked further under the
  // new one, then spring-settled back to its resting offset.
  const flinchY = useSharedValue(0);

  useEffect(() => {
    if (!bounceTrigger || reduceMotion) return;
    settleY.value = withSequence(
      withTiming(-5, { duration: Motion.duration.flash }),
      withSpring(0, Motion.spring.land)
    );
  }, [bounceTrigger, reduceMotion, settleY]);

  // No `|| reduceMotion`: `flinchFor` already reads it and answers 0, the way
  // `traumaFor` does for the shake this composes with (#763).
  useEffect(() => {
    if (!flinchTrigger) return;
    const distance = flinchFor(flinchTier ?? "ordinary", reduceMotion);
    if (distance === 0) return;
    flinchY.value = withSequence(
      withTiming(distance, { duration: Motion.duration.flash }),
      withSpring(0, Motion.spring.land)
    );
  }, [flinchTrigger, flinchTier, reduceMotion, flinchY]);

  useEffect(
    () => () => {
      cancelAnimation(settleY);
      cancelAnimation(flinchY);
    },
    [settleY, flinchY]
  );

  const bounceStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: settleY.value }],
  }));

  const prevLayerStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${PILE_PREV_ROTATE_DEG}deg` },
      { translateY: PILE_PREV_Y + flinchY.value },
    ],
  }));

  const isPower = current && POWER_COMBOS.has(current.type);

  return (
    <Animated.View style={[pileStyles.pileArea, bounceStyle]} testID="pile-area">
      {roundWinner && (
        <Animated.View
          entering={reduceMotion ? undefined : FadeIn.duration(Motion.duration.travel)}
          exiting={reduceMotion ? undefined : FadeOut.duration(Motion.duration.travel)}
          style={pileStyles.winnerTag}
        >
          <Ionicons name="star" size={9} color={Colors.gold} />
          <TableText style={pileStyles.winnerText}>{roundWinner}</TableText>
        </Animated.View>
      )}

      <View style={pileStyles.pileStack}>
        {/* The beaten combination stays under the new one, rotated off-axis,
            the way the previous trick sits under the one that took it. */}
        {prev && (
          <Animated.View
            style={[pileStyles.pilePrevLayer, prevLayerStyle]}
            pointerEvents="none"
          >
            <PileComboCards cards={prev.cards} scale={cardScale} roomW={roomW} />
          </Animated.View>
        )}
        {current && (
          <PileComboCards
            cards={current.cards}
            scale={cardScale}
            roomW={roomW}
            catchTrigger={catchTrigger}
          />
        )}
      </View>

      {current && (
        <View style={pileStyles.comboLabel}>
          <View style={[pileStyles.comboChip, isPower && pileStyles.comboChipPower]}>
            <TableText style={[pileStyles.comboChipText, isPower && pileStyles.comboChipTextPower]}>
              {isPower ? "✦ " : ""}
              {COMBO_LABEL_KEYS[current.type] ? t(COMBO_LABEL_KEYS[current.type]) : current.type}
              {current.cards.length > 2 ? t("gameShared.comboMultiplier", { count: current.cards.length }) : ""}
            </TableText>
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
    zIndex: Layer.sheet,
  },
  flyingInner: {
    alignItems: "center",
    justifyContent: "center",
  },
  pileArea: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 80,
  },
  // Behind a catching card, never on it — the same childless-sibling
  // substitute for an animated shadow hand.tsx's cardGlow uses. Which of the
  // two that is has to be stated, not written: the iOS renderer paints siblings
  // in its own order (#209), and "behind" is the whole of this effect.
  catchGlow: {
    position: "absolute",
    top: 2, left: 2, right: 2, bottom: 2,
    zIndex: Layer.felt,
    borderRadius: Radius.sm,
    backgroundColor: Colors.gold,
    ...Shadow.goldSoft,
  },
  caughtCard: { zIndex: Layer.table },
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
    zIndex: Layer.rail,
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
