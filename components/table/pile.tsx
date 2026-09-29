import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { View, StyleSheet } from "react-native";
import { TableText } from "./TableText";
import Animated, {
  makeMutable,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
  withSequence,
  Easing,
  cancelAnimation,
  FadeIn,
  FadeOut,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import Ionicons from "@expo/vector-icons/Ionicons";
import { CardView } from "@/components/CardView";
import { Colors, FontSize, Motion, motionMs, Radius, Scrim, Shadow, Spacing, Layer } from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { traceOnset, useTraceSource } from "@/lib/e2eTrace";
import { DIAGNOSTICS, diag } from "@/lib/diagnostics";
import { readFlightFromDom } from "./flightTrace";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import type { Card, Combination } from "@/lib/game/gameEngine";
import { CARD_W, CARD_H, FIELD_SCALE, cardRadius } from "@/components/cardFaceModel";
import { seatDirection, type FlyDirection } from "@/components/seatLayout";
import { comboKey, flinchFor, landingTier, LAND_WOBBLE_MS, landWobble, readThrownPlay, roundClosedWithWinner, seatPoint, type ThrownPlayInput } from "@/components/flightPhysics";
import { beatenPlay, clearTrick, NO_TRICK, playOnto, sweepEnded, sweepTrick, topPlay, type Trick, type TrickPlay } from "./trick";
import { flightPose, pileSlots, type CardFrom } from "@/components/flightPose";
import { Sweep } from "@/components/table/moments";
import { a11yHidden } from "@/lib/a11y";
import { landingPulsesFor } from "@/lib/device/moments";
import { flightSpec, inBackground, NO_LANDING, useFlightClock, type FlightClock, type FlightSpec, type LandingPayload, type LandingSignal } from "./useFlightClock";
import { useLandingReaction } from "./useLandingReaction";
import type { TableTimeline } from "./tableTimeline";

/**
 * Where a combination's cards sit on the felt, the flight's own slots. A
 * combination mid-throw and the same combination the frame after it lands are
 * one call, so it cannot shift as it arrives.
 */
function fieldSlots(cards: Card[], cardScale: number, roomW: number) {
  const w = CARD_W(cardScale);
  const h = CARD_H(cardScale);
  const slots = pileSlots(cards.length, w, roomW);
  const span = cards.length > 1 ? slots[cards.length - 1].x - slots[0].x : 0;
  return { slots, w, h, boxW: span + w };
}

// ─── FlyingCards ──────────────────────────────────────────────────────────────

interface FlightCallbacks {
  onStart?: (key: string, landsAt: number, endsAt: number) => void;
  onEnd: (key: string) => void;
  onContact?: (key: string) => void;
  /** This flight's clock, once, for whatever else must move on it. */
  onClock?: (key: string, clock: FlightClock) => void;
}

export function FlyingCards({ cards, flight, landing, signal, bombClock, scale = 1, ...callbacks }: FlightCallbacks & {
  cards: Card[];
  flight: FlightSpec;
  landing: LandingPayload;
  signal: SharedValue<LandingSignal>;
  /** A heavy flight's own clock, for the scrim, until it touches. */
  bombClock?: SharedValue<BombClock>;
  scale?: number;
}) {
  const cardScale = scale * FIELD_SCALE;
  const w = CARD_W(cardScale);
  const h = CARD_H(cardScale);
  const on = useRef(callbacks);
  useEffect(() => {
    on.current = callbacks;
  });
  const started = useCallback((k: string, at: number, end: number) => on.current.onStart?.(k, at, end), []);
  const ended = useCallback((k: string) => on.current.onEnd(k), []);
  const touched = useCallback((k: string, at: number) => {
    traceOnset("moment", "landing");
    if (DIAGNOSTICS) diag({ k: "trigger", t: at, name: "flightContact" });
    on.current.onContact?.(k);
  }, []);
  const clock = useFlightClock(signal, started, touched, ended);
  const [armed] = useState(() => ({ spec: flight, landing }));
  const { spec } = armed;
  // Read live, not from the spec: a toggle mid-flight brings the cards to rest on the next frame (#786).
  const still = usePrefersReducedMotion() || spec.reduced;
  useEffect(() => {
    on.current.onClock?.(armed.spec.key, clock);
    clock.arm(armed.landing);
    clock.begin(armed.spec);
  }, [clock, armed]);
  const heavy = armed.landing.heavy;
  useAnimatedReaction(
    () => clock.elapsed.value,
    (t) => {
      if (heavy && bombClock) bombClock.set(t < spec.contact ? { elapsed: t, contact: spec.contact } : NO_BOMB);
    }
  );
  useEffect(() => () => {
    if (heavy) bombClock?.set(NO_BOMB);
  }, [heavy, bombClock]);
  const group = useAnimatedStyle(() => {
    const k = still ? 0 : Math.min(1, Math.max(0, (clock.elapsed.value - spec.end) / LAND_WOBBLE_MS));
    const { scale: s, rotate } = landWobble(k);
    return { transform: [{ scale: s }, { rotate: `${rotate}deg` }] };
  });
  return (
    <Animated.View testID="flying-cards" pointerEvents="none" style={[StyleSheet.absoluteFill, group]} {...a11yHidden()}>
      {cards.map((card, i) => (
        <FlyingCard key={card.id} card={card} i={i} spec={spec} still={still} elapsed={clock.elapsed} w={w} h={h} cardScale={cardScale} />
      ))}
    </Animated.View>
  );
}

function FlyingCard({ card, i, spec, still, elapsed, w, h, cardScale }: {
  card: Card; i: number; spec: FlightSpec; still: boolean; elapsed: SharedValue<number>; w: number; h: number; cardScale: number;
}) {
  const to = spec.to[i];
  const style = useAnimatedStyle(() => {
    const p = flightPose(still ? Infinity : elapsed.value, i, spec.n, spec.from[i], to, spec.catchUp);
    return {
      transform: [{ translateX: p.x - to.x }, { translateY: p.y - to.y }, { rotate: `${p.rot}deg` }, { scale: p.scale }],
    };
  });
  const box = { position: "absolute" as const, left: "50%" as const, top: "50%" as const, width: w, height: h, marginLeft: to.x - w / 2, marginTop: to.y - h / 2 };
  return (
    <>
      <View testID="flight-slot" pointerEvents="none" style={box} />
      <Animated.View testID="flying-card" style={[box, { zIndex: i }, style]}>
        <CardView card={card} scale={cardScale} light="flat" />
      </Animated.View>
    </>
  );
}

// ─── SweepCards ───────────────────────────────────────────────────────────────

const SWEEP_SCALE = 0.6;

/** A closed round's cards collected toward the seat that won them. */
export function SweepCards({
  plays,
  origin,
  roomW,
  scale = 1,
  onDone,
}: {
  plays: readonly TrickPlay[];
  /** The winner's seat — components/flightPhysics.ts `seatPoint`. */
  origin: { dx: number; dy: number };
  roomW: number;
  scale?: number;
  /** The fade's own end: the swept cards leave the felt on it. */
  onDone: () => void;
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
    fade.value = withSequence(
      withTiming(0, { duration: travelMs - shiftMs }),
      withTiming(1, { duration: shiftMs }, (finished) => {
        if (finished) scheduleOnRN(onDone);
      })
    );
    return () => {
      cancelAnimation(travel);
      cancelAnimation(fade);
    };
  }, [reduceMotion, travel, fade, onDone]);

  const aStyle = useAnimatedStyle(() => ({
    opacity: 1 - fade.value,
    transform: [
      { translateX: travel.value * origin.dx },
      { translateY: travel.value * origin.dy },
      { scale: 1 - travel.value * fade.value * (1 - SWEEP_SCALE) },
    ],
  }));

  const cardScale = scale * FIELD_SCALE;
  const prev = beatenPlay({ plays })?.combo;
  const current = topPlay({ plays })?.combo;
  return (
    <View style={[pileStyles.flyingContainer, { pointerEvents: "none" as const }]}>
      <Animated.View testID="sweep-cards" style={[pileStyles.pileStack, aStyle]}>
        {prev && (
          <View
            style={[
              pileStyles.pilePrevLayer,
              { transform: [{ rotate: `${PILE_PREV_ROTATE_DEG}deg` }, { translateY: PILE_PREV_Y }] },
            ]}
          >
            <PileComboCards cards={prev.cards} scale={cardScale} roomW={roomW} />
          </View>
        )}
        {current && (
          <PileComboCards cards={current.cards} scale={cardScale} roomW={roomW} />
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
  const { slots, w, h, boxW } = fieldSlots(cards, scale, roomW);
  return (
    <View style={{ width: boxW, height: h, position: "relative" }}>
      {slots.map((slot, i) => {
        const face = <CardView card={cards[i]} scale={scale} light="flat" />;
        return (
          <View
            key={cards[i].id}
            style={{
              position: "absolute",
              left: boxW / 2 + slot.x - w / 2,
              top: slot.y,
              zIndex: i,
              transform: [{ rotate: `${slot.rot}deg` }],
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
  comboLabel = current,
  roundWinner,
  catchTrigger,
  landing,
  roomW,
  scale = 1,
  note,
}: {
  prev: Combination | null;
  current: Combination | null;
  /** Said by the combination's chip in place of the combination: the exchange's who gives what to whom, under the card resting there. */
  note?: { text: string; testID: string; cards: Card[] } | null;
  /**
   * The combination the chip names. Defaults to `current`; pass it
   * separately only when the chip must show before `current` does — the
   * landing — while `current` itself stays gated on
   * `flyInfo` to protect the once-only card render (#828).
   */
  comboLabel?: Combination | null;
  roundWinner: string | null;
  /** The flush: the play just landed emptied a hand. */
  catchTrigger?: number;
  /** The beaten pile flinches on the contact frame of the play that beat it (#764). */
  landing?: SharedValue<LandingSignal>;
  /** The width share the field's arc may take — see FIELD_WIDTH_SHARE. */
  roomW: number;
  /** The table's own scale — the pile draws its cards at `scale * FIELD_SCALE`. */
  scale?: number;
}) {
  const { t } = useTranslation();
  const cardScale = scale * FIELD_SCALE;
  const reduceMotion = usePrefersReducedMotion();
  // The beaten combination's own reaction (#764): knocked further under the
  // new one, then spring-settled back to its resting offset.
  const flinchY = useSharedValue(0);

  // No `|| reduceMotion`: `flinchFor` already reads it and answers 0, the way
  // `traumaFor` does for the shake this composes with (#763). `* scale` for
  // the same reason `shakeOffset` takes a scale — a knock is a fraction of
  // the table, not a fixed pixel count.
  const [idle] = useState(() => makeMutable(NO_LANDING));
  useLandingReaction(landing ?? idle, (l) => {
    "worklet";
    const distance = flinchFor(l.tier, reduceMotion) * scale;
    if (distance === 0) return;
    flinchY.set(withSequence(withTiming(distance, { duration: Motion.duration.flash }), withSpring(0, Motion.spring.land)));
  });

  useEffect(() => () => cancelAnimation(flinchY), [flinchY]);

  const prevLayerStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${PILE_PREV_ROTATE_DEG}deg` },
      { translateY: PILE_PREV_Y + flinchY.value },
    ],
  }));

  const isPower = comboLabel && POWER_COMBOS.has(comboLabel.type);

  return (
    <Animated.View style={pileStyles.pileArea} testID="pile-area">
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

      {note ? (
        <View
          {...a11yHidden()}
          style={[
            pileStyles.noteLabel,
            { width: roomW, marginLeft: -roomW / 2, marginTop: fieldSlots(note.cards, cardScale, roomW).h / 2 + Spacing.snug },
          ]}
        >
          <ComboChip isPower={false} still>
            <TableText testID={note.testID} style={pileStyles.comboChipText}>
              {note.text}
            </TableText>
          </ComboChip>
        </View>
      ) : comboLabel && (
        <View
          style={[
            pileStyles.comboLabel,
            { marginTop: fieldSlots(comboLabel.cards, cardScale, roomW).h / 2 + Spacing.snug },
          ]}
        >
          <ComboChip isPower={!!isPower}>
            <TableText style={[pileStyles.comboChipText, isPower && pileStyles.comboChipTextPower]}>
              {isPower ? "✦ " : ""}
              {COMBO_LABEL_KEYS[comboLabel.type] ? t(COMBO_LABEL_KEYS[comboLabel.type]) : comboLabel.type}
              {comboLabel.cards.length > 2 ? t("gameShared.comboMultiplier", { count: comboLabel.cards.length }) : ""}
            </TableText>
          </ComboChip>
        </View>
      )}
    </Animated.View>
  );
}

const CHIP_RISE = Spacing.xs;
const FELT_SCRIM_PEAK = 0.25;
const SCRIM_EASING = Easing.in(Easing.quad);

/** The bomb in the air: its clock until contact, then `NO_BOMB`. */
export interface BombClock {
  elapsed: number;
  contact: number;
}
const NO_BOMB: BombClock = { elapsed: -1, contact: 0 };

/** `still`: shown on the frame it mounts, for a note the leg's own clock times. */
function ComboChip({ isPower, still = false, children }: { isPower: boolean; still?: boolean; children: ReactNode }) {
  const reduceMotion = usePrefersReducedMotion() || still;
  const enter = useSharedValue(reduceMotion ? 1 : 0);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    enter.value = reduceMotion
      ? 1
      : withTiming(1, { duration: Motion.duration.shift, easing: Easing.out(Easing.quad) });
  }, [reduceMotion, enter]);

  useEffect(() => () => cancelAnimation(enter), [enter]);

  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * CHIP_RISE }],
  }));

  return (
    <Animated.View
      testID="combo-chip"
      style={[pileStyles.comboChip, isPower && pileStyles.comboChipPower, enterStyle]}
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {children}
      {isPower && !reduceMotion && (
        <View testID="combo-chip-sheen" style={StyleSheet.absoluteFill} pointerEvents="none">
          {size && <Sweep trigger={1} width={size.w} height={size.h} durationMs={Motion.duration.reveal} />}
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
   * second render the dedupe below skips, so a flight still in the air is
   * re-armed with the tier it now closes on.
   */
  matchOver: boolean;
  /** The table's one timeline: a throw's landing sound waits there for the flight's reported contact. */
  timeline: Pick<TableTimeline, "awaitFlight" | "moment" | "flightStarted" | "drop">;
  celebrateFlush: () => void;
  /** Each flight's clock, once, as it starts — the same clock the bomb's scrim is drawn from. */
  onClock?: (key: string, clock: FlightClock) => void;
  playRoundStart: () => void;
  /** The viewer's hand cards as last drawn (`StraightHand`'s `onOrigins`), from the hand zone's centre. */
  handOrigins: { readonly current: ReadonlyMap<string, CardFrom> };
  /** The width share the field's cards may take — see FIELD_WIDTH_SHARE. */
  roomW: number;
  /** A reconnect is replaying the table, so the throw is the mockup's shorter catch-up. */
  catchUp: boolean;
}

export interface FlyInfo {
  key: string;
  dir: FlyDirection;
  cards: Card[];
  spec: FlightSpec;
  landing: LandingPayload;
  comboType: Combination["type"];
  handOver: boolean;
  /** Thrown while no frames were drawn (`inBackground`). */
  hidden: boolean;
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
  timeline,
  celebrateFlush,
  onClock,
  playRoundStart,
  handOrigins,
  roomW,
  catchUp,
}: PileFlightInput) {
  const reduceMotion = usePrefersReducedMotion();
  const { awaitFlight, moment, flightStarted, drop } = timeline;
  useTraceSource("flight", readFlightFromDom);

  // The seat that took the last round and a counter of how many rounds have
  // closed. The counter is what makes an identical repeat a new announcement:
  // the seat that wins a round leads the next one, so the same seat winning
  // twice running is ordinary play.
  const [roundWinnerTag, setRoundWinnerTag] = useState<{ seat: number; closure: number } | null>(
    null
  );
  const [trick, setTrick] = useState<Trick>(NO_TRICK);
  const [flights, setFlights] = useState<FlyInfo[]>([]);
  const flightsRef = useRef(flights);
  useEffect(() => {
    flightsRef.current = flights;
  });
  const touched = useRef(new Set<string>());
  const started = useRef(new Set<string>());
  // Non-null while the winning combination is being held on the felt under the
  // round-winner tag. Its presence is what tells the pile effect the felt is
  // spoken for.
  const roundHoldRef = useRef<{ timer: ReturnType<typeof setTimeout>; collect: () => void } | null>(
    null
  );
  const prevComboKeyRef = useRef<string>("");
  const roundClosedRef = useRef(false);
  const matchOverRef = useRef(matchOver);
  const clocks = useRef(new Map<string, FlightClock>());
  useEffect(() => {
    matchOverRef.current = matchOver;
    for (const f of flightsRef.current) {
      if (touched.current.has(f.key)) continue;
      clocks.current.get(f.key)?.arm({ ...f.landing, tier: landingTier({ comboType: f.comboType, handOver: f.handOver, matchOver }) });
    }
  }, [matchOver]);

  // The bomb's flight writes its own clock here from the UI thread, so the scrim darkens on the
  // frames the bomb falls and lifts on the one it lands.
  const bombClock = useSharedValue<BombClock>(NO_BOMB);
  const feltDim = useDerivedValue(() => {
    const { elapsed, contact } = bombClock.value;
    return elapsed < 0 ? 0 : FELT_SCRIM_PEAK * SCRIM_EASING(Math.min(1, elapsed / contact));
  });

  useEffect(
    () => () => {
      if (roundHoldRef.current) clearTimeout(roundHoldRef.current.timer);
    },
    []
  );

  // The dedupe on `prevComboKeyRef` comes before anything with an effect, so a
  // re-run for one of the other dependencies leaves the pile, the flying card
  // and the pending impact exactly as they were.
  useEffect(() => {
    // Clearing the felt and announcing a new round are one beat, whether it
    // happens now or after the winning cards have been held.
    const openNewRound = () => {
      playRoundStart();
      setTrick(clearTrick);
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
        setTrick(clearTrick);
        return;
      }
      prevComboKeyRef.current = "";
      if (roundClosedWithWinner({ lastPlayedCombination: combo, roundWinner })) {
        const origin = seatPoint(geometry, seatDirection(roundWinner!, viewerSeat, players.length));
        const collect = () => {
          roundHoldRef.current = null;
          setTrick((t) => sweepTrick(t, origin));
          openNewRound();
        };
        roundHoldRef.current = { timer: setTimeout(collect, ROUND_WINNER_MS), collect };
        return;
      }
      openNewRound();
      return;
    }
    const key = comboKey(combo, lastPlayedBy);
    if (key === prevComboKeyRef.current) return;
    // A lead inside the hold window ends it early: the new card has to fly
    // onto a cleared pile while the won cards sweep away underneath it.
    if (roundHoldRef.current) {
      clearTimeout(roundHoldRef.current.timer);
      roundHoldRef.current.collect();
    }
    prevComboKeyRef.current = key;

    const thrown = readThrownPlay({ ...geometry, combo, playedBy: lastPlayedBy }, handOrigins.current);

    // The owner's ruling: throws queued while nothing was drawn land at once and in silence, all but the newest.
    const unseen = new Set(flightsRef.current.filter((f) => f.hidden && !started.current.has(f.key)).map((f) => f.key));
    unseen.forEach(drop);
    awaitFlight(key);
    moment({ kind: "landing", cards: combo.cards.length, bomb: thrown.heavy, mine: thrown.dir === "bottom" });

    const to = pileSlots(thrown.cards.length, CARD_W(scale * FIELD_SCALE), roomW);
    const landing: LandingPayload = {
      tier: landingTier({ comboType: combo.type, handOver: gameOver, matchOver: matchOverRef.current }),
      cards: thrown.cards.length,
      x: thrown.pile.x,
      y: thrown.pile.y,
      flush: thrown.emptiedHand,
      heavy: thrown.heavy,
      mine: thrown.dir === "bottom",
      pulses: landingPulsesFor({ cards: thrown.cards.length, bomb: thrown.heavy, mine: thrown.dir === "bottom" }),
    };
    const spec = flightSpec(key, thrown.from, to, catchUp, reduceMotion);
    setTrick((t) => playOnto(t, { key, combo, playedBy: lastPlayedBy, spec }));
    const flight = {
      key, dir: thrown.dir, cards: thrown.cards, spec, landing, comboType: combo.type, handOver: gameOver,
      hidden: inBackground(),
    };
    const superseded = new Set([...touched.current, ...unseen]);
    touched.current = new Set();
    superseded.forEach((k) => clocks.current.delete(k));
    setFlights((f) => [...f.filter((x) => !superseded.has(x.key)), flight]);
  }, [
    lastPlayedCombination,
    lastPlayedBy,
    roundWinner,
    gameOver,
    viewerSeat,
    players.length,
    reduceMotion,
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
    handOrigins,
    roomW,
    catchUp,
    awaitFlight,
    moment,
    drop,
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

  // A round closes on a pass, never on a play, so the round-win sting is that
  // closing pass's own event (useTableFeedback) and this tag is only the banner —
  // the round-start sting is deferred for as long as it is up.
  useEffect(() => {
    if (roundWinnerTag === null) return;
    const dismiss = setTimeout(() => setRoundWinnerTag(null), ROUND_WINNER_MS);
    return () => clearTimeout(dismiss);
  }, [roundWinnerTag]);

  // A flight still in the air when the next play lands keeps flying; one that
  // has touched its slot yields it to the pile, so a card is never drawn twice.
  const onFlightContact = useCallback(
    (key: string) => {
      touched.current.add(key);
      const flight = flightsRef.current.find((f) => f.key === key);
      if (flight?.landing.flush) celebrateFlush();
    },
    [celebrateFlush]
  );
  const onFlightStart = useCallback(
    (key: string, landsAt: number, endsAt: number) => {
      started.current.add(key);
      flightStarted(key, landsAt, endsAt);
    },
    [flightStarted]
  );
  const onFlightDone = useCallback((key: string) => {
    touched.current.delete(key);
    started.current.delete(key);
    clocks.current.delete(key);
    setFlights((f) => f.filter((x) => x.key !== key));
  }, []);
  const onFlightClock = useCallback(
    (key: string, clock: FlightClock) => {
      clocks.current.set(key, clock);
      onClock?.(key, clock);
    },
    [onClock]
  );

  const endSweep = useCallback(() => setTrick(sweepEnded), []);

  return {
    trick,
    endSweep,
    flights,
    roundWinnerTag,
    onFlightStart,
    onFlightContact,
    onFlightDone,
    onFlightClock,
    bombClock,
    feltDim,
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
  // Out of the flow and hung off the centre: in it, the chip's arrival would lift the cards the
  // flight has just set down.
  comboLabel: { position: "absolute", top: "50%", left: 0, right: 0, alignItems: "center" },
  // The field's width, not the pile's: an empty pile is as narrow as its minimum, and the note wraps a word a line.
  noteLabel: { position: "absolute", top: "50%", left: "50%", alignItems: "center" },
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
    overflow: "hidden",
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
