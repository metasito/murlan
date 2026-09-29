import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { View, StyleSheet } from "react-native";
import { TableText } from "./TableText";
import Animated, {
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
import { seatDirection } from "@/components/seatLayout";
import { comboKey, flinchFor, landingTier, LAND_WOBBLE_MS, landWobble, readThrownPlay, roundClosedWithWinner, seatPoint, type ThrownPlayInput } from "@/components/flightPhysics";
import { clearTrick, NO_TRICK, playOnto, roleOf, sweepEnded, sweepTrick, topPlay, type PlayRole, type Trick, type TrickPlay } from "./trick";
import { flightPose, pileSlots, type CardFrom } from "@/components/flightPose";
import { Sweep } from "@/components/table/moments";
import { a11yHidden } from "@/lib/a11y";
import { landingPulsesFor } from "@/lib/device/moments";
import { AT_REST, flightSpec, inBackground, useFlightClock, type FlightClock, type FlightSpec, type LandingPayload, type LandingSignal } from "./useFlightClock";
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

/** A play still in the air: what it lands with, from `usePileFlight`. */
export interface Flight extends TrickPlay {
  landing: LandingPayload;
  handOver: boolean;
  /** Thrown while no frames were drawn (`inBackground`). */
  hidden: boolean;
}

interface Report {
  start: (key: string, landsAt: number, endsAt: number) => void;
  touch: (key: string, at: number) => void;
  end: (key: string) => void;
  clock: (key: string, clock: FlightClock) => void;
}

interface SweepMotion {
  travel: SharedValue<number>;
  fade: SharedValue<number>;
  to: { dx: number; dy: number };
}

const SWEEP_SCALE = 0.6;

// The flush's "catch": a hand-emptying play's own cards bloom gold and lift,
// same 620ms every time — verbatim off the prototype's `catch` keyframe.
// Two segments (0-50%, 50-100%), each ease-out, rather than one duration
// straight through: the bloom and lift both peak at the midpoint and return,
// not ramp continuously to it.
const CATCH_MS = 620;
const CATCH_LIFT = -9;
const CATCH_EASING = Easing.out(Easing.cubic);

// The beaten group's resting pose, folded into the group's own worklet — the
// flinch (#764) and the sweep ride the same one, so a second `transform` array
// cannot clobber it (React Native replaces a style's `transform` wholesale).
const PILE_PREV_ROTATE_DEG = -7;
const PILE_PREV_Y = 9;
const PILE_PREV_OPACITY = 0.3;

const ROLE_RANK: Record<PlayRole, number> = { buried: 0, beaten: 1, top: 2 };
// Over the moments, as the sweep and the throw were before they shared the pile's list.
const SWEPT_Z = Layer.sheet;
const FLYING_Z = SWEPT_Z + ROLE_RANK.top + 1;

// ─── PlayGroup ────────────────────────────────────────────────────────────────

/**
 * One play's cards, from the throw to the sweep: they fly on the play's own
 * clock, rest on the felt, are beaten, buried and swept on these same views.
 */
function PlayGroup({ play, flight, role, sweep, sweepTop, hidden, flinchY, signal, bombClock, report, cardScale, roomW }: {
  play: TrickPlay;
  /** Non-null while the play is in the air; a group mounted without one never flies. */
  flight: Flight | null;
  role: PlayRole;
  sweep: SweepMotion | null;
  sweepTop: boolean;
  /** Out of sight at rest; a play still moving is drawn regardless. */
  hidden: boolean;
  flinchY: SharedValue<number>;
  signal: SharedValue<LandingSignal>;
  bombClock?: SharedValue<BombClock>;
  report: Report;
  cardScale: number;
  roomW: number;
}) {
  const cards = play.combo.cards;
  const [armed, setArmed] = useState(flight);
  // The same play thrown again (a replay scrubbing back) is a new throw on these views.
  if (flight !== null && flight !== armed) setArmed(flight);
  const spec = armed?.spec ?? play.spec;
  const clock = useFlightClock(signal, report.start, report.touch, report.end, armed === null);
  const flying = flight !== null;
  // Read live, not from the spec: a toggle mid-flight brings the cards to rest on the next frame (#786).
  const still = usePrefersReducedMotion() || spec.reduced;
  useEffect(() => {
    if (!armed) return;
    report.clock(armed.key, clock);
    clock.arm(armed.landing);
    clock.begin(armed.spec);
  }, [clock, armed, report]);
  const flush = armed?.landing.flush ?? false;
  const catching = useSharedValue(0);
  const settled = useRef<Flight | null>(null);
  useEffect(() => {
    if (flying || !armed || settled.current === armed) return;
    settled.current = armed;
    // Only a flight that came to rest on its own frames catches; one withdrawn unseen lands in silence.
    if (flush && !still && clock.elapsed.get() >= armed.spec.end + LAND_WOBBLE_MS) {
      const half = CATCH_MS / 2;
      catching.set(withSequence(withTiming(1, { duration: half, easing: CATCH_EASING }), withTiming(0, { duration: half, easing: CATCH_EASING })));
    }
    clock.halt();
  }, [flying, armed, clock, flush, still, catching]);
  useEffect(() => () => cancelAnimation(catching), [catching]);

  const heavy = armed?.landing.heavy ?? false;
  // The scrim is this bomb's only until it touches: after that another may be falling.
  useAnimatedReaction(
    () => clock.elapsed.value,
    (t, was) => {
      if (!heavy || !bombClock) return;
      if (t < spec.contact) bombClock.set({ elapsed: t, contact: spec.contact });
      else if (was !== null && was < spec.contact) bombClock.set(NO_BOMB);
    }
  );
  const { elapsed } = clock;
  const contact = spec.contact;
  useEffect(() => () => {
    if (heavy && elapsed.get() < contact) bombClock?.set(NO_BOMB);
  }, [heavy, bombClock, elapsed, contact]);

  const wobble = useAnimatedStyle(() => {
    const k = still ? 0 : Math.min(1, Math.max(0, (clock.elapsed.value - spec.end) / LAND_WOBBLE_MS));
    const { scale: s, rotate } = landWobble(k);
    return { transform: [{ scale: s }, { rotate: `${rotate}deg` }] };
  });

  const beaten = role === "beaten" && !flying;
  const pose = useAnimatedStyle(() => {
    const transform: ({ translateX: number } | { translateY: number } | { scale: number } | { rotate: string })[] = [];
    let opacity = beaten ? PILE_PREV_OPACITY : 1;
    if (sweep) {
      const t = sweep.travel.value;
      transform.push({ translateX: t * sweep.to.dx }, { translateY: t * sweep.to.dy }, { scale: 1 - t * sweep.fade.value * (1 - SWEEP_SCALE) });
      opacity *= 1 - sweep.fade.value;
    }
    if (beaten) transform.push({ rotate: `${PILE_PREV_ROTATE_DEG}deg` }, { translateY: PILE_PREV_Y + flinchY.value });
    return { opacity, transform };
  });

  const { slots, w, h } = fieldSlots(cards, cardScale, roomW);
  const testID = beaten && !sweep ? "pile-prev-layer" : sweepTop ? "sweep-cards" : undefined;
  const zIndex = flying ? FLYING_Z : (sweep ? SWEPT_Z : Layer.table) + ROLE_RANK[role];
  const out = !flying && (role === "buried" || (hidden && !sweep));
  return (
    <Animated.View
      testID={testID}
      pointerEvents="none"
      style={[pileStyles.group, { zIndex }, out && pileStyles.buried, pose]}
      {...a11yHidden(flying || sweep !== null)}
    >
      <Animated.View testID={flying ? "flying-cards" : undefined} pointerEvents="none" style={[StyleSheet.absoluteFill, wobble]}>
        {cards.map((card, i) => {
          const box = { position: "absolute" as const, left: slots[i].x - w / 2, top: slots[i].y - h / 2, width: w, height: h };
          return (
            <Fragment key={card.id}>
              {flying && <View testID="flight-slot" pointerEvents="none" style={box} />}
              <PlayCard card={card} i={i} spec={spec} still={still} elapsed={clock.elapsed} box={box} flying={flying} catching={flush ? catching : null} cardScale={cardScale} />
            </Fragment>
          );
        })}
      </Animated.View>
    </Animated.View>
  );
}

function PlayCard({ card, i, spec, still, elapsed, box, flying, catching, cardScale }: {
  card: Card;
  i: number;
  spec: FlightSpec;
  still: boolean;
  elapsed: SharedValue<number>;
  box: { position: "absolute"; left: number; top: number; width: number; height: number };
  flying: boolean;
  /** Null for a play that empties no hand: it never catches. */
  catching: SharedValue<number> | null;
  cardScale: number;
}) {
  const from = spec.from[i];
  const to = spec.to[i];
  const style = useAnimatedStyle(() => {
    const p = flightPose(still ? AT_REST : elapsed.value, i, spec.n, from, to, spec.catchUp);
    return {
      transform: [{ translateX: p.x - to.x }, { translateY: p.y - to.y }, { rotate: `${p.rot}deg` }, { scale: p.scale }],
    };
  });
  // 0 at rest, 1 at the top of the lift — the table's own scale multiplies it
  // at render, so resizing the table cannot read as a fresh catch.
  const lift = useAnimatedStyle(() => ({ transform: [{ translateY: (catching?.value ?? 0) * CATCH_LIFT * cardScale }] }));
  // Opacity only, on a childless sibling behind the card — the same
  // compositor-safe substitute for an animated shadow hand.tsx's cardGlow uses.
  const glow = useAnimatedStyle(() => ({ opacity: catching?.value ?? 0 }));
  return (
    <Animated.View testID={flying ? "flying-card" : undefined} style={[box, { zIndex: i }, style]}>
      <Animated.View style={lift}>
        {catching && <Animated.View pointerEvents="none" style={[pileStyles.catchGlow, { borderRadius: cardRadius(CARD_W(cardScale)) }, glow]} />}
        <View style={pileStyles.caughtCard}>
          <CardView testID="pile-card" card={card} scale={cardScale} light="flat" />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

// ─── The pile's notices ───────────────────────────────────────────────────────

const COMBO_LABEL_KEYS: Record<string, TranslationKey> = {
  single:        "gameShared.comboSingle",
  pair:          "gameShared.comboPair",
  triple:        "gameShared.comboTriple",
  straight:      "gameShared.comboStraight",
  bomb:          "gameShared.comboBomb",
  royal_straight: "gameShared.comboRoyalStraight",
};

const POWER_COMBOS = new Set(["bomb", "royal_straight"]);

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
function ChipPlate({ isPower, still = false, children }: { isPower: boolean; still?: boolean; children: ReactNode }) {
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

/** The combination on top of the pile, named. `scale` is the table's. */
export function ComboChip({ isPower, label, scale }: { isPower: boolean; label: string; scale: number }) {
  return (
    <View style={{ transform: [{ scale }] }}>
      <ChipPlate isPower={isPower}>
        <TableText style={[pileStyles.comboChipText, isPower && pileStyles.comboChipTextPower]}>
          {isPower ? "✦ " : ""}
          {label}
        </TableText>
      </ChipPlate>
    </View>
  );
}

/** The seat that took the round, over the pile. `scale` is the table's. */
export function RoundWinnerTag({ name, scale }: { name: string; scale: number }) {
  const reduceMotion = usePrefersReducedMotion();
  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(Motion.duration.travel)}
      exiting={reduceMotion ? undefined : FadeOut.duration(Motion.duration.travel)}
      style={[pileStyles.winnerTag, { transform: [{ scale }] }]}
    >
      <Ionicons name="star" size={9} color={Colors.gold} />
      <TableText style={pileStyles.winnerText}>{name}</TableText>
    </Animated.View>
  );
}

// ─── PileLayer ────────────────────────────────────────────────────────────────

export interface PileNote { text: string; testID: string; cards: Card[] }

export interface PileLayerProps {
  trick: Trick;
  /** The plays in the air, each until its flight reports its end. */
  flights: readonly Flight[];
  signal: SharedValue<LandingSignal>;
  /** A heavy flight's own clock, for the scrim, until it touches. */
  bombClock?: SharedValue<BombClock>;
  onFlightStart?: (key: string, landsAt: number, endsAt: number) => void;
  onFlightContact?: (key: string) => void;
  onFlightEnd: (key: string) => void;
  /** Each flight's clock, once, for whatever else must move on it. */
  onFlightClock?: (key: string, clock: FlightClock) => void;
  /** The sweep's fade has ended: the swept trick leaves the felt. */
  onSweepEnd: () => void;
  /** The combination the chip names, which may run ahead of the cards landing. */
  comboLabel: Combination | null;
  roundWinner: string | null;
  /** Said by the combination's chip in place of the combination: the exchange's who gives what to whom, under the card resting there. */
  note?: PileNote | null;
  /** The width share the field's arc may take — see FIELD_WIDTH_SHARE. */
  roomW: number;
  /** The table's own scale — the pile draws its cards at `scale * FIELD_SCALE`. */
  scale?: number;
  /** Out of the layout while something else holds the centre: plays at rest hide, and a play still moving keeps moving. */
  hidden?: boolean;
}

/**
 * Every play of the trick and the swept trick, each one group of views from
 * the throw to the end of its sweep, with the pile's chip, note and winner tag.
 */
export function PileLayer(props: PileLayerProps) {
  const { trick, flights, signal, bombClock, comboLabel, roundWinner, note, roomW, scale = 1, hidden = false } = props;
  const { t } = useTranslation();
  const cardScale = scale * FIELD_SCALE;
  const reduceMotion = usePrefersReducedMotion();

  const on = useRef(props);
  useEffect(() => {
    on.current = props;
  });
  const [report] = useState<Report>(() => ({
    start: (k, at, end) => on.current.onFlightStart?.(k, at, end),
    touch: (k, at) => {
      traceOnset("moment", "landing");
      if (DIAGNOSTICS) diag({ k: "trigger", t: at, name: "flightContact" });
      on.current.onFlightContact?.(k);
    },
    end: (k) => on.current.onFlightEnd(k),
    clock: (k, c) => on.current.onFlightClock?.(k, c),
  }));
  const sweepEnd = useCallback(() => on.current.onSweepEnd(), []);

  // The beaten combination's own reaction (#764): knocked further under the
  // new one, then spring-settled back to its resting offset. No `|| reduceMotion`:
  // `flinchFor` already reads it and answers 0. `* scale` because a knock is a
  // fraction of the table, not a fixed pixel count.
  const flinchY = useSharedValue(0);
  useLandingReaction(signal, (l) => {
    "worklet";
    const distance = flinchFor(l.tier, reduceMotion) * scale;
    if (distance === 0) return;
    flinchY.set(withSequence(withTiming(distance, { duration: Motion.duration.flash }), withSpring(0, Motion.spring.land)));
  });
  useEffect(() => () => cancelAnimation(flinchY), [flinchY]);

  const swept = trick.swept;
  const travel = useSharedValue(0);
  const fade = useSharedValue(0);
  const seated = useRef<Trick["swept"]>(null);
  useEffect(() => {
    if (!swept) return;
    // A motion preference changing mid-sweep finishes this sweep, never starts it over.
    if (seated.current !== swept) {
      seated.current = swept;
      travel.value = 0;
      fade.value = 0;
    }
    const travelMs = motionMs("travel", reduceMotion);
    const shiftMs = motionMs("shift", reduceMotion);
    if (!reduceMotion) travel.value = withTiming(1, { duration: travelMs, easing: Easing.in(Easing.cubic) });
    fade.value = withSequence(
      withTiming(0, { duration: travelMs - shiftMs }),
      withTiming(1, { duration: shiftMs }, (finished) => {
        if (finished) scheduleOnRN(sweepEnd);
      })
    );
    return () => {
      cancelAnimation(travel);
      cancelAnimation(fade);
    };
  }, [swept, reduceMotion, travel, fade, sweepEnd]);
  const sweep = useMemo(() => (swept ? { travel, fade, to: swept.to } : null), [swept, travel, fade]);

  // One list, so a play keeps its views as it moves from the felt to the sweep.
  const sweeping = swept?.plays ?? [];
  const held = new Set([...sweeping, ...trick.plays].map((p) => p.key));
  const groups = [
    ...sweeping.map((play, i) => ({ play, role: roleOf(sweeping, i), sweep, sweepTop: i === sweeping.length - 1 })),
    ...trick.plays.map((play, i) => ({ play, role: roleOf(trick.plays, i), sweep: null, sweepTop: false })),
    ...flights.filter((f) => !held.has(f.key)).map((play) => ({ play, role: "top" as const, sweep: null, sweepTop: false })),
  ];
  const flightOf = new Map(flights.map((f) => [f.key, f]));

  const top = topPlay(trick.plays);
  const stack = top ? fieldSlots(top.combo.cards, cardScale, roomW) : null;
  const isPower = !!comboLabel && POWER_COMBOS.has(comboLabel.type);
  const label = getComboLabel(comboLabel, t);

  // A plain view with no z-index of its own, so each group's `zIndex` reaches the moments beside it.
  return (
    <View style={[pileStyles.pileArea, hidden && pileStyles.aside]} testID="pile-area">
      {roundWinner && !hidden ? <RoundWinnerTag name={roundWinner} scale={scale} /> : null}

      <View style={[pileStyles.pileStack, { width: stack?.boxW ?? 0, height: stack?.h ?? 0 }]}>
        {groups.map(({ play, role, sweep: motion, sweepTop }) => (
          <PlayGroup
            key={play.key}
            play={play}
            flight={flightOf.get(play.key) ?? null}
            role={role}
            sweep={motion}
            sweepTop={sweepTop}
            hidden={hidden}
            flinchY={flinchY}
            signal={signal}
            bombClock={bombClock}
            report={report}
            cardScale={cardScale}
            roomW={roomW}
          />
        ))}
      </View>

      {hidden ? null : note ? (
        <View
          {...a11yHidden()}
          style={[
            pileStyles.noteLabel,
            { width: roomW, marginLeft: -roomW / 2, marginTop: fieldSlots(note.cards, cardScale, roomW).h / 2 + Spacing.snug },
          ]}
        >
          <ChipPlate isPower={false} still>
            <TableText testID={note.testID} style={pileStyles.comboChipText}>
              {note.text}
            </TableText>
          </ChipPlate>
        </View>
      ) : comboLabel && label !== null && (
        <View
          style={[
            pileStyles.comboLabel,
            { marginTop: fieldSlots(comboLabel.cards, cardScale, roomW).h / 2 + Spacing.snug },
          ]}
        >
          <ComboChip isPower={isPower} label={label} scale={scale} />
        </View>
      )}
    </View>
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
  const [flights, setFlights] = useState<Flight[]>([]);
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
      clocks.current.get(f.key)?.arm({ ...f.landing, tier: landingTier({ comboType: f.combo.type, handOver: f.handOver, matchOver }) });
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
    const play: TrickPlay = { key, combo, playedBy: lastPlayedBy, spec: flightSpec(key, thrown.from, to, catchUp, reduceMotion) };
    setTrick((t) => playOnto(t, play));
    unseen.forEach((k) => clocks.current.delete(k));
    touched.current.delete(key);
    started.current.delete(key);
    setFlights((f) => [...f.filter((x) => !unseen.has(x.key) && x.key !== key), { ...play, landing, handOver: gameOver, hidden: inBackground() }]);
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
  // A point at the pile's centre, so a group turns, wobbles and sweeps about it.
  group: { position: "absolute", left: "50%", top: "50%", width: 0, height: 0 },
  buried: { display: "none" },
  // Out of the flow while something else holds the centre, still centred for whatever is moving.
  aside: { position: "absolute" },
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
