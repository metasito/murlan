import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import Ionicons from "@expo/vector-icons/Ionicons";
import { CardView } from "@/components/CardView";
import { Colors, FontSize, Hold, Motion, motionMs, Radius, Scrim, Shadow, Spacing, Layer } from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import type { Card, Combination, CombinationType } from "@/lib/gameEngine";
import { CARD_W, CARD_H, FIELD_SCALE, cardRadius } from "@/components/cardFaceModel";
import { type FlyDirection } from "@/components/seatLayout";
import { COMBO_MAX_TILT, advancePile, anticipationOffset, cardTilt, collectPile, comboKey, EMPTY_PILE, FLIGHT_MS, flinchFor, impactDelayMs, landingHoldMs, landingTier, landSquashScale, NO_PILE, readThrownPlay, roundClosedWithWinner, settleForMotion, seatPoint, type ImpactTier, type PileLayers, type PileState, type ThrownPlayInput } from "@/components/flightPhysics";
import { FIELD_ARC, solveArc } from "@/components/tableArc";

const FLY_ROTS: Record<FlyDirection, number> = {
  bottom: -12, top: 12, left: -18, right: 18,
};
// The settle's overshoot rock, not a resting pose: the flight always comes to
// rest at 0deg, the same group rotation PileComboCards draws at, so the two
// views hand off without a jump (#828). This only shapes how far the card
// rocks past that mark before it gets there.
const SETTLE_ROCK_ROTS: Record<FlyDirection, number> = {
  bottom: -4, top: 5, left: -7, right: 7,
};
// How high the throw arcs and how far it drives into the felt before rocking
// back. The flight's duration lives in flightPhysics, because the table times
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
  /** Where the throw starts — components/flightPhysics.ts `flightOrigin`. */
  origin: { dx: number; dy: number };
  onDone: () => void;
  /** The width share the field's arc may take — see FIELD_WIDTH_SHARE. */
  roomW: number;
  /** The table's own scale — the pile draws its cards at `scale * FIELD_SCALE`. */
  scale?: number;
}) {
  const { dx, dy } = origin;
  const startRot = FLY_ROTS[direction];
  const rockRot = SETTLE_ROCK_ROTS[direction];
  const reduceMotion = usePrefersReducedMotion();

  // A ref rather than the prop, so a caller handing over a fresh closure
  // cannot restart the flight effect below mid-flight. The ref is written
  // after commit, never during render — the only reader is a timer or an
  // animation callback, both of which fire later.
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
  const lifted = useSharedValue(1);

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
    const load = anticipationOffset(dx, dy);
    const anticipate = { duration: Motion.anticipate, easing: Easing.out(Easing.quad) };
    tx.value = withSequence(withTiming(dx + load.x, anticipate), withTiming(0, { duration: FLIGHT_MS, easing }));
    ty.value = withSequence(withTiming(dy + load.y, anticipate), withTiming(0, { duration: FLIGHT_MS, easing }));
    // The flight's own resting rotation is the pile's — 0, PileComboCards'
    // own group rotation — so the handoff from FlyingCards to PlayedPile
    // cannot read as a jump (#828).
    rot.value = withSequence(
      withTiming(startRot, anticipate),
      withTiming(0, { duration: FLIGHT_MS, easing: Easing.out(Easing.cubic) })
    );
    arcY.value = withDelay(
      Motion.anticipate,
      withSequence(
        withTiming(-ARC_PEAK, { duration: FLIGHT_MS * 0.5, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: FLIGHT_MS * 0.5, easing: Easing.in(Easing.quad) })
      )
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

    lifted.value = withDelay(
      impactDelayMs(reduceMotion),
      withTiming(0, { duration: landingHoldMs(reduceMotion) })
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
      cancelAnimation(lifted);
    };
    // Every entry is stable for the life of one flight — the caller remounts
    // this component via `key` for each new one — so this runs once per flight.
  }, [reduceMotion, notifyDone, dx, dy, startRot, tx, ty, rot, opacity, arcY, settle, lifted]);

  const aStyle = useAnimatedStyle(() => {
    const squash = landSquashScale(settle.value);
    return {
      transform: [
        { translateX: tx.value },
        { translateY: ty.value + arcY.value + settle.value * LAND_DIP * scale },
        { rotate: `${rot.value + settle.value * rockRot * 0.4}deg` },
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
            <LiftedShadow lifted={lifted} width={CARD_W(cardScale)} height={cardH} />
            <View style={pileStyles.caughtCard}>
              <CardView card={cards[i]} scale={cardScale} light="flat" />
            </View>
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

/** Its own animated style per card: one style bound to several views drives only one of them. */
function LiftedShadow({ lifted, width, height }: { lifted: SharedValue<number>; width: number; height: number }) {
  const style = useAnimatedStyle(() => ({ opacity: lifted.value }));
  return (
    <Animated.View
      testID="flying-shadow-lifted"
      style={[pileStyles.liftedShadow, { width, height, borderRadius: cardRadius(width) }, style]}
    />
  );
}

// ─── SweepCards ───────────────────────────────────────────────────────────────

const SWEEP_SCALE = 0.6;

/** A closed round's cards collected toward the seat that won them. */
export function SweepCards({
  pile,
  origin,
  roomW,
  scale = 1,
}: {
  pile: PileState;
  /** The winner's seat — components/flightPhysics.ts `seatPoint`. */
  origin: { dx: number; dy: number };
  roomW: number;
  scale?: number;
}) {
  const reduceMotion = usePrefersReducedMotion();
  const travel = useSharedValue(0);
  const fade = useSharedValue(0);

  useEffect(() => {
    const travelMs = motionMs("travel", reduceMotion);
    const shiftMs = motionMs("shift", reduceMotion);
    travel.value = reduceMotion
      ? 0
      : withTiming(1, { duration: travelMs, easing: Easing.in(Easing.cubic) });
    fade.value = withDelay(travelMs - shiftMs, withTiming(1, { duration: shiftMs }));
    return () => {
      cancelAnimation(travel);
      cancelAnimation(fade);
    };
  }, [reduceMotion, travel, fade]);

  const aStyle = useAnimatedStyle(() => ({
    opacity: 1 - fade.value,
    transform: [
      { translateX: travel.value * origin.dx },
      { translateY: travel.value * origin.dy },
      { scale: 1 - travel.value * fade.value * (1 - SWEEP_SCALE) },
    ],
  }));

  const cardScale = scale * FIELD_SCALE;
  return (
    <View style={[pileStyles.flyingContainer, { pointerEvents: "none" as const }]}>
      <Animated.View testID="sweep-cards" style={[pileStyles.pileStack, aStyle]}>
        {pile.prev && (
          <View
            style={[
              pileStyles.pilePrevLayer,
              { transform: [{ rotate: `${PILE_PREV_ROTATE_DEG}deg` }, { translateY: PILE_PREV_Y }] },
            ]}
          >
            <PileComboCards cards={pile.prev.cards} scale={cardScale} roomW={roomW} />
          </View>
        )}
        {pile.current && (
          <PileComboCards cards={pile.current.cards} scale={cardScale} roomW={roomW} />
        )}
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
      <Animated.View
        pointerEvents="none"
        style={[pileStyles.catchGlow, { borderRadius: cardRadius(CARD_W(scale)) }, glowStyle]}
      />
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

// The land spring's own overshoot on the whole pile — an ordinary win's
// entire reaction (#764's tier table). Scaled at the trigger, the way `kick`
// (useTableFeedback.ts) scales its own jolts, rather than left as a fixed
// pixel count that reads huge on a phone and vanishes on a tablet (#790).
const PILE_BOUNCE_DIP = 5;

export function PlayedPile({
  prev,
  current,
  comboLabel = current,
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
  /**
   * The combination the chip names. Defaults to `current`; pass it
   * separately only when the chip must show before `current` does — the
   * landing, `flightLanded` — while `current` itself stays gated on
   * `flyInfo` to protect the once-only card render (#828).
   */
  comboLabel?: Combination | null;
  roundWinner: string | null;
  bounceTrigger?: number;
  /** The flush: the play just landed emptied a hand. */
  catchTrigger?: number;
  /** Increments at the same `impactDelayMs()` landing everything else on the table reads — the beaten pile's own reaction to being displaced (#764). */
  flinchTrigger?: number;
  /** The tier `flinchTrigger`'s landing resolved to — flightPhysics.ts `flinchFor`. */
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
      withTiming(-PILE_BOUNCE_DIP * scale, { duration: Motion.duration.flash }),
      withSpring(0, Motion.spring.land)
    );
  }, [bounceTrigger, reduceMotion, scale, settleY]);

  // No `|| reduceMotion`: `flinchFor` already reads it and answers 0, the way
  // `traumaFor` does for the shake this composes with (#763). `* scale` for
  // the same reason `shakeOffset` takes a scale — a knock is a fraction of
  // the table, not a fixed pixel count.
  useEffect(() => {
    if (!flinchTrigger) return;
    const distance = flinchFor(flinchTier ?? "ordinary", reduceMotion) * scale;
    if (distance === 0) return;
    flinchY.value = withSequence(
      withTiming(distance, { duration: Motion.duration.flash }),
      withSpring(0, Motion.spring.land)
    );
  }, [flinchTrigger, flinchTier, reduceMotion, scale, flinchY]);

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

  const isPower = comboLabel && POWER_COMBOS.has(comboLabel.type);

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
            testID="pile-prev-layer"
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

      {comboLabel && (
        <View style={pileStyles.comboLabel}>
          <View style={[pileStyles.comboChip, isPower && pileStyles.comboChipPower]}>
            <TableText style={[pileStyles.comboChipText, isPower && pileStyles.comboChipTextPower]}>
              {isPower ? "✦ " : ""}
              {COMBO_LABEL_KEYS[comboLabel.type] ? t(COMBO_LABEL_KEYS[comboLabel.type]) : comboLabel.type}
              {comboLabel.cards.length > 2 ? t("gameShared.comboMultiplier", { count: comboLabel.cards.length }) : ""}
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

// ─── usePileFlight ────────────────────────────────────────────────────────────

// How long the round-winner tag stays over the pile. A domain beat, not a
// generic UI transition, so it is not a Motion token.
const ROUND_WINNER_MS = 1800;

export interface PileFlightInput extends Omit<ThrownPlayInput, "combo" | "playedBy"> {
  lastPlayedCombination: Combination | null;
  lastPlayedBy: number;
  roundWinner: number | null;
  gameOver: boolean;
  /**
   * Online, `matchOver` arrives on its own socket packet after `gameOver` — a
   * second render the dedupe below skips, so the impact timeout reads a ref
   * (current at the moment it fires) rather than the `matchOver` its own
   * scheduling render closed over.
   */
  matchOver: boolean;
  /**
   * Every beat a landing earns, passed in rather than reached for: the table
   * owns `useTableFeedback`, and `tests/native` loads this module on its own,
   * where the audio native module has no JS implementation to import.
   */
  playImpact: (heavy: boolean, dir: FlyDirection, comboType: CombinationType) => void;
  shake: (tier: ImpactTier) => void;
  burst: (tier: ImpactTier) => void;
  celebrateFlush: () => void;
  playRoundStart: () => void;
  playRoundWin: () => void;
}

/**
 * The flying card, the pile under it and the round-winner tag over it, derived
 * straight from the game state so a card can never be shown twice or dropped.
 * CLAUDE.md marks this load-bearing.
 */
export function usePileFlight({
  lastPlayedCombination,
  lastPlayedBy,
  roundWinner,
  gameOver,
  matchOver,
  viewerSeat,
  players,
  opponents,
  scale,
  windowWidth,
  windowHeight,
  tableLeft,
  tableRight,
  tableTop,
  surplus,
  bottomPad,
  handCardH,
  playImpact,
  shake,
  burst,
  celebrateFlush,
  playRoundStart,
  playRoundWin,
}: PileFlightInput) {
  const reduceMotion = usePrefersReducedMotion();

  // The seat that took the last round and a counter of how many rounds have
  // closed. The counter is what makes an identical repeat a new announcement:
  // the seat that wins a round leads the next one, so the same seat winning
  // twice running is ordinary play.
  const [roundWinnerTag, setRoundWinnerTag] = useState<{ seat: number; closure: number } | null>(
    null
  );
  const [layers, setLayers] = useState<PileLayers>(NO_PILE);
  const [sweepTo, setSweepTo] = useState<{ dx: number; dy: number } | null>(null);
  const [bounceTrigger, setBounceTrigger] = useState(0);
  // The beaten pile's own reaction (#764): fired from the same impactDelayMs()
  // landing the shake and the impact sound wait for, never a second guess at it.
  const [flinchTrigger, setFlinchTrigger] = useState(0);
  const [flinchTier, setFlinchTier] = useState<ImpactTier>("ordinary");
  const [flyInfo, setFlyInfo] = useState<{
    key: string;
    dir: FlyDirection;
    cards: Card[];
    /** Where the throw starts — components/flightPhysics.ts `flightOrigin`. */
    origin: { dx: number; dy: number };
  } | null>(null);
  // False for exactly impactDelayMs() from the moment a flight begins — the
  // throwing seat's own held count and departing backs read off this, not off
  // flyInfo's own lifetime, which runs past the landing to cover `FlyingCards`'
  // settle spring too.
  const [flightLanded, setFlightLanded] = useState(true);
  const landTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Impact feedback is scheduled for the moment the thrown card lands, so it
  // has to be cancellable: a fast next play, or leaving the table, must not
  // fire a bang for a card that is no longer in the air.
  const impactTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Non-null while the winning combination is being held on the felt under the
  // round-winner tag. Its presence is what tells the pile effect the felt is
  // spoken for.
  const roundHoldRef = useRef<{ timer: ReturnType<typeof setTimeout>; collect: () => void } | null>(
    null
  );
  const sweepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevComboKeyRef = useRef<string>("");
  const roundClosedRef = useRef(false);
  const matchOverRef = useRef(matchOver);
  useEffect(() => {
    matchOverRef.current = matchOver;
  }, [matchOver]);

  useEffect(
    () => () => {
      if (impactTimerRef.current) clearTimeout(impactTimerRef.current);
      if (roundHoldRef.current) clearTimeout(roundHoldRef.current.timer);
      if (sweepTimerRef.current) clearTimeout(sweepTimerRef.current);
      if (landTimerRef.current) clearTimeout(landTimerRef.current);
    },
    []
  );

  // The dedupe on `prevComboKeyRef` comes before anything with an effect, so a
  // re-run for one of the other dependencies leaves the pile, the flying card
  // and the pending impact exactly as they were.
  useEffect(() => {
    // A flight ending early — a new lead before it landed, the table leaving —
    // must not leave a stale hold on the throwing seat's own count.
    const clearLanding = () => {
      if (landTimerRef.current) {
        clearTimeout(landTimerRef.current);
        landTimerRef.current = null;
      }
      setFlightLanded(true);
    };

    // Clearing the felt and announcing a new round are one beat, whether it
    // happens now or after the winning cards have been held.
    const openNewRound = () => {
      playRoundStart();
      setLayers((l) => ({ ...l, onPile: EMPTY_PILE }));
      setFlyInfo(null);
      clearLanding();
    };

    const geometry = {
      viewerSeat,
      players,
      opponents,
      scale,
      windowWidth,
      windowHeight,
      tableLeft,
      tableRight,
      tableTop,
      surplus,
      bottomPad,
      handCardH,
    };
    const combo = lastPlayedCombination;
    if (combo === null) {
      // The winning cards are being held for the tag; nothing may take the
      // felt out from under them until the hold expires or a new lead arrives.
      if (roundHoldRef.current) return;
      if (prevComboKeyRef.current === "") {
        setLayers((l) => ({ ...l, onPile: EMPTY_PILE }));
        setFlyInfo(null);
        clearLanding();
        return;
      }
      if (impactTimerRef.current) clearTimeout(impactTimerRef.current);
      prevComboKeyRef.current = "";
      if (roundClosedWithWinner({ lastPlayedCombination: combo, roundWinner })) {
        const origin = seatPoint(geometry, roundWinner!);
        const collect = () => {
          roundHoldRef.current = null;
          setLayers(collectPile);
          setSweepTo(origin);
          openNewRound();
          if (sweepTimerRef.current) clearTimeout(sweepTimerRef.current);
          sweepTimerRef.current = setTimeout(() => {
            sweepTimerRef.current = null;
            setLayers((l) => ({ ...l, swept: null }));
            setSweepTo(null);
          }, motionMs("travel", reduceMotion));
        };
        roundHoldRef.current = { timer: setTimeout(collect, ROUND_WINNER_MS), collect };
        return;
      }
      openNewRound();
      return;
    }
    const key = comboKey(combo, lastPlayedBy);
    if (key === prevComboKeyRef.current) return;
    if (impactTimerRef.current) clearTimeout(impactTimerRef.current);
    // A lead inside the hold window ends it early: the new card has to fly
    // onto a cleared pile while the won cards sweep away underneath it.
    if (roundHoldRef.current) {
      clearTimeout(roundHoldRef.current.timer);
      roundHoldRef.current.collect();
    }
    prevComboKeyRef.current = key;
    setLayers((l) => ({ ...l, onPile: advancePile(l.onPile, combo, lastPlayedBy) }));

    const thrown = readThrownPlay({ ...geometry, combo, playedBy: lastPlayedBy });

    // The card is thrown here and arrives ~213ms later, so everything that
    // reads as *impact* waits for it. Announced for every seat, not only the
    // viewer's: the sound belongs to a card landing, not to a tap.
    impactTimerRef.current = setTimeout(() => {
      const tier = landingTier({
        comboType: combo.type,
        handOver: gameOver,
        matchOver: matchOverRef.current,
      });
      playImpact(thrown.heavy, thrown.dir, combo.type);
      shake(tier);
      burst(tier);
      setFlinchTier(tier);
      setFlinchTrigger((t) => t + 1);
      if (thrown.emptiedHand) celebrateFlush();
    }, impactDelayMs(reduceMotion));

    // The throwing seat's held count and departing backs read off this same
    // boundary — the fan and the badge drop the instant the impact fires,
    // not whenever FlyingCards' settle spring happens to finish.
    if (landTimerRef.current) clearTimeout(landTimerRef.current);
    setFlightLanded(false);
    landTimerRef.current = setTimeout(() => {
      landTimerRef.current = null;
      setFlightLanded(true);
    }, impactDelayMs(reduceMotion));

    setFlyInfo({ key, dir: thrown.dir, cards: thrown.cards, origin: thrown.origin });
  }, [
    lastPlayedCombination,
    lastPlayedBy,
    roundWinner,
    gameOver,
    viewerSeat,
    players.length,
    reduceMotion,
    playImpact,
    shake,
    burst,
    celebrateFlush,
    playRoundStart,
    players,
    opponents,
    scale,
    windowWidth,
    windowHeight,
    tableLeft,
    tableRight,
    tableTop,
    surplus,
    bottomPad,
    handCardH,
  ]);

  // Round-winner tag over the pile, keyed on the round *closing* rather than on
  // the value of `roundWinner`: processPlay leaves that field standing through
  // the round the winner goes on to lead, so with two players it never changes
  // and every win after the first would go unannounced. The seat is what is
  // stored, not the name — the name is looked up at render, so a game update
  // that only changes the player list cannot restart the banner's own timers.
  useEffect(() => {
    if (!roundClosedWithWinner({ lastPlayedCombination, roundWinner })) {
      roundClosedRef.current = false;
      return;
    }
    if (roundClosedRef.current) return;
    roundClosedRef.current = true;
    const seat = roundWinner!;
    setRoundWinnerTag((prev) => ({ seat, closure: (prev?.closure ?? 0) + 1 }));
  }, [lastPlayedCombination, roundWinner]);

  // A round closes on a pass, never on a play, so nothing is in flight here and
  // the sting is the first sound of the beat — ahead of the round-start sting,
  // which the pile effect has deferred for as long as this tag is up.
  useEffect(() => {
    if (roundWinnerTag === null) return;
    playRoundWin();
    const dismiss = setTimeout(() => setRoundWinnerTag(null), ROUND_WINNER_MS);
    return () => clearTimeout(dismiss);
  }, [roundWinnerTag, playRoundWin]);

  // The settle is what ends a flight, so the bounce the pile answers with is
  // bumped from the same callback that takes the flying cards away.
  const onFlightDone = useCallback(() => {
    setFlyInfo(null);
    setBounceTrigger((t) => t + 1);
  }, []);

  return {
    pileState: layers.onPile,
    sweep: layers.swept && sweepTo && { pile: layers.swept, origin: sweepTo },
    flyInfo,
    flightLanded,
    flinchTrigger,
    flinchTier,
    bounceTrigger,
    roundWinnerTag,
    onFlightDone,
  };
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
    backgroundColor: Colors.gold,
    ...Shadow.goldSoft,
  },
  caughtCard: { zIndex: Layer.table },
  // Only the raised half of the landing: the card's own stock already carries
  // Shadow.card, so a second resting sibling would double it until the pile
  // takes the card over.
  liftedShadow: {
    position: "absolute",
    top: 0,
    left: 0,
    zIndex: Layer.felt,
    backgroundColor: Colors.cardPaper,
    ...Shadow.cardLifted,
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
