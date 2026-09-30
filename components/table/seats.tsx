import { useCallback, useEffect, useMemo, useState } from "react";
import { View, StyleSheet, type ViewProps } from "react-native";
import { TableText } from "./TableText";
import { PassedMark, ReconnectingMark, VacatedMark } from "./notices/seatMarks";
import { mockupPx } from "./noticeModel";
import {
  FAN_DRAWN_CARDS,
  SEAT_DISC,
  SEAT_LABEL_GAP,
  SEAT_LABEL_PAD,
  seatGap,
  seatLabelH,
} from "@/components/seatLayout";
import { FAN_TURN, fanCounts, seatFanArc } from "@/components/fanGeometry";
import { passedSeats } from "@/components/flightPhysics";
import { handCountOf } from "@/shared/protocol";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withRepeat,
  withDelay,
  withSequence,
  interpolate,
  ReduceMotion,
  Easing,
  cancelAnimation,
  useAnimatedReaction,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import type { DealArrivals } from "./deal";
import type { RingFlash } from "./ExchangeLegs";
import Svg, { Path } from "react-native-svg";
import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { CardView } from "@/components/CardView";
import type { ArcCard } from "@/components/tableArc";
import type { OpponentSide } from "@/components/seatLayout";
import { BACK_SCALE, tableFontSize } from "@/components/cardFaceModel";
import { Colors, LastCard, makeShadow, Motion, motionMs, Radius, Spacing } from "@/lib/theme";
import { urgentThresholdSeconds } from "@/components/turnTimerUi";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import type { Combination, Player } from "@/lib/game/gameEngine";
import { useRingProbe } from "@/lib/diagnostics";

/** An exchange's marks on a seat: lit while its card is in the air, pinged as it leaves or rests. */
export interface SeatMark { lit: boolean; seat: number; flash: SharedValue<RingFlash> }

/**
 * Which seats have already answered the round on the table. Derived rather
 * than stored, so a new lead empties it on the same commit that lands the
 * card and no effect has to clear it.
 */
export function usePassedSeats(
  currentTurnIndex: number,
  lastPlayedBy: number,
  lastPlayedCombination: Combination | null,
  players: readonly Player[]
): number[] {
  return useMemo(
    () =>
      passedSeats({
        currentTurnIndex,
        lastPlayedBy,
        lastPlayedCombination,
        outOfCards: players.map((p) => handCountOf(p) === 0),
      }),
    [currentTurnIndex, lastPlayedBy, lastPlayedCombination, players]
  );
}

// ─── CardFan ──────────────────────────────────────────────────────────────────
//
// Three opponents around a table, each seat the same construction rotated a
// quarter turn. The arc opens toward its own player — a bowl, not a dome — by
// flipping its own offsets; the container is never rotated for it, because the
// arc deliberately overflows its box and rotating the box would leave half of
// it empty and open a phantom gap between the avatar and the cards.

/**
 * How far the fan leans away from the viewer, in its own frame — so a side
 * player leans sideways from the same line of code as the top player leaning
 * back. The perspective is what turns the lean into depth rather than a squash.
 */
const FAN_LEAN_DEG = -17;
const FAN_PERSPECTIVE = 560;

function FanBack({ at, boxW, backScale, isActive, zIndex }: {
  at: ArcCard;
  boxW: number;
  backScale: number;
  isActive: boolean;
  zIndex: number;
}) {
  return (
    <View
      testID="seat-back"
      style={{
        position: "absolute",
        zIndex,
        transform: [{ translateX: boxW / 2 + at.x }, { translateY: at.y }, { rotate: `${at.rot}deg` }],
      }}
    >
      <CardView
        card={{ id: "bk", suit: null, rank: "3", isJoker: false }}
        faceDown
        scale={backScale}
        light={isActive ? "standingLit" : "standing"}
      />
    </View>
  );
}

function CardFan({
  count,
  side,
  isActive,
  scale = 1,
}: {
  /** The seat's count; the thrown cards left it at the throw (ADR-0008). */
  count: number;
  side: OpponentSide;
  /** This seat is on move, so the lamp is over it and its backs are lit. */
  isActive: boolean;
  /** The table's own scale — the fan draws its backs at `scale * BACK_SCALE`. */
  scale?: number;
}) {
  if (count === 0) return null;

  const backScale = scale * BACK_SCALE;
  // A fan is never width-budgeted: the seat's own column bounds it, and it is the rise that binds.
  const full = seatFanArc(fanCounts(count, FAN_DRAWN_CARDS[side]), backScale);
  const bounds = full.bounds;

  // The wrapper is what the cards occupy once turned, so the seat's own row or
  // column reserves exactly that and the ring-to-fan gap is one number on all
  // three seats.
  const turn = FAN_TURN[side];
  const wrapW = turn === 0 ? bounds.w : bounds.h;
  const wrapH = turn === 0 ? bounds.h : bounds.w;

  return (
    <View style={{ width: wrapW, height: wrapH }}>
      <View
        style={{
          position: "absolute",
          width: full.box.w,
          height: full.box.h,
          left: wrapW / 2 - bounds.cx,
          top: wrapH / 2 - bounds.cy,
          transformOrigin: [bounds.cx, bounds.cy, 0],
          transform: [
            { perspective: FAN_PERSPECTIVE * backScale },
            { rotate: `${turn}deg` },
            { rotateX: `${FAN_LEAN_DEG}deg` },
          ],
        }}
      >
        {full.cards.map((card, i) => (
          <FanBack key={i} at={card} boxW={full.box.w} backScale={backScale} isActive={isActive} zIndex={i} />
        ))}
      </View>
    </View>
  );
}

/**
 * How many of a deal's cards have landed at this seat, read off the deal's own
 * clock. Unbounded with no deal running or once the last has landed, so a card
 * the seat is handed later still counts.
 */
function useArrivedCount(arrivals: DealArrivals | undefined): number {
  const [n, setN] = useState(0);
  const [of, setOf] = useState(arrivals);
  if (of !== arrivals) {
    setOf(arrivals);
    setN(0);
  }
  const at = arrivals?.at;
  const clock = arrivals?.clock;
  useAnimatedReaction(
    () => (at && clock ? at.filter((ms) => ms <= clock.value).length : 0),
    (now, prev) => {
      if (now !== prev) scheduleOnRN(setN, now);
    },
    [at, clock]
  );
  if (!arrivals) return Infinity;
  return n >= arrivals.at.length ? Infinity : n;
}

// ─── SeatRing ─────────────────────────────────────────────────────────────────
//
// A seat is one dark disc with a gold rule around it: a chip on the cloth, not
// a photo. Everything the seat has to say rides on it — the initials in the
// middle, the cards left in a badge at its foot, and, while the seat is on
// move, the turn's own clock sweeping the rim.

/** How far the countdown ring stands off the disc, and how thick it is drawn. */
const RING_GAP = 4;
const RING_STROKE = 2;
/**
 * A fifth turn signal, past the four #194 budgets, and one the prototype has
 * no equivalent for — deliberate, not an unswept leftover of the port.
 */
const RING_PING_SCALE = 1.45;
/** The urgent ring's 1Hz dim-and-back: a repeating beat, not a one-shot transition, so not a Motion step. */
const RING_PULSE_MS = 1000;
const RING_PULSE_LOW = 0.6;

/**
 * The turn clock, drawn as an arc around the seat on move. It is a display of
 * the same window the viewer's own chip counts down, so it is armed by the
 * turn changing rather than by a deadline of its own — there is no per-seat
 * deadline to read, online or off.
 */
function CountdownRing({
  size,
  seconds,
  resetKey,
  scale,
}: {
  size: number;
  seconds: number;
  resetKey: string;
  scale: number;
}) {
  const stroke = RING_STROKE * scale;
  const box = size + RING_GAP * 2 * scale;
  const r = (box - stroke) / 2;
  const swept = useSharedValue(0);
  const urgent = useSharedValue(0);
  const pulse = useSharedValue(1);
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    swept.value = 0;
    urgent.value = 0;
    pulse.value = 1;
    const urgentFor = urgentThresholdSeconds(seconds);
    const calmMs = Math.max(seconds - urgentFor, 0) * 1000;
    // The delay is the clock itself, not motion: under the system's reduced
    // motion Reanimated would skip it and turn the ring red at once.
    urgent.value = withDelay(
      calmMs,
      withTiming(1, { duration: motionMs("shift", reduceMotion) }),
      ReduceMotion.Never
    );
    if (!reduceMotion) {
      swept.value = withTiming(1, { duration: seconds * 1000, easing: Easing.linear });
      const dim = { duration: RING_PULSE_MS / 2, easing: Easing.inOut(Easing.sin) };
      pulse.value = withDelay(
        calmMs,
        withRepeat(withSequence(withTiming(RING_PULSE_LOW, dim), withTiming(1, dim)), urgentFor),
        ReduceMotion.Never
      );
    }
    return () => {
      cancelAnimation(swept);
      cancelAnimation(urgent);
      cancelAnimation(pulse);
    };
  }, [resetKey, seconds, reduceMotion, swept, urgent, pulse]);

  // Each half of the ring turns out of its own clip, clockwise from twelve
  // o'clock: a transform the compositor runs, where an animated stroke prop
  // re-rasterises the SVG every frame.
  const rightTurn = useAnimatedStyle(() => ({
    transform: [{ rotate: `${Math.min(swept.value, 0.5) * 360}deg` }],
  }));
  const leftTurn = useAnimatedStyle(() => ({
    transform: [{ rotate: `${Math.max(swept.value - 0.5, 0) * 360}deg` }],
  }));
  // One style per view: an animated style drives only one of the views it is given.
  const rightRed = useAnimatedStyle(() => ({ opacity: urgent.value }));
  const leftRed = useAnimatedStyle(() => ({ opacity: urgent.value }));
  const rightGold = useAnimatedStyle(() => ({ opacity: 1 - urgent.value }));
  const leftGold = useAnimatedStyle(() => ({ opacity: 1 - urgent.value }));
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));
  const c = box / 2;
  const arc = (d: string, colour: string) => (
    <Svg width={box} height={box}>
      <Path d={d} stroke={colour} strokeWidth={stroke} strokeLinecap="round" fill="none" />
    </Svg>
  );
  // Two arcs cross-faded rather than one recoloured, for the same reason the
  // sweep is a transform: opacity composites, an animated stroke re-rasterises.
  const half = (d: string, gold: typeof rightGold, red: typeof rightRed, testID: string) => (
    <>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, gold]}>{arc(d, Colors.goldLit)}</Animated.View>
      <Animated.View testID={testID} pointerEvents="none" style={[StyleSheet.absoluteFill, red]}>
        {arc(d, Colors.danger)}
      </Animated.View>
    </>
  );

  return (
    <Animated.View
      testID="seat-turn-clock"
      pointerEvents="none"
      style={[
        seatStyles.ring,
        { top: -RING_GAP * scale, left: -RING_GAP * scale, width: box, height: box },
        pulseStyle,
      ]}
    >
      <View style={[seatStyles.ringClip, { left: c, width: c, height: box }]}>
        <Animated.View
          testID="seat-turn-clock-right"
          style={[seatStyles.ring, { left: -c, width: box, height: box }, rightTurn]}
        >
          {half(`M ${c} ${c - r} A ${r} ${r} 0 0 1 ${c} ${c + r}`, rightGold, rightRed, "seat-turn-clock-urgent-right")}
        </Animated.View>
      </View>
      <View style={[seatStyles.ringClip, { left: 0, width: c, height: box }]}>
        <Animated.View
          testID="seat-turn-clock-left"
          style={[seatStyles.ring, { left: 0, width: box, height: box }, leftTurn]}
        >
          {half(`M ${c} ${c + r} A ${r} ${r} 0 0 1 ${c} ${c - r}`, leftGold, leftRed, "seat-turn-clock-urgent-left")}
        </Animated.View>
      </View>
    </Animated.View>
  );
}

/** One full brighten-and-fade cycle of the focus-mode breathing ring. */
const BREATHE_MS = 3400;
const BREATHE_GLOW = 30;

function SeatRing({
  name,
  isActive,
  cardCount,
  finishPos,
  scale,
  countdown,
  focusMode = false,
  mark,
}: {
  name: string;
  isActive: boolean;
  cardCount: number;
  finishPos?: number;
  scale: number;
  /** The turn window, on the seat that is on move. Absent on every other seat. */
  countdown?: { seconds: number; resetKey: string };
  /** The felt and this ring are what carry the turn — everything else on the seat is quiet. */
  focusMode?: boolean;
  mark?: SeatMark;
}) {
  // One shot when the seat takes the turn: the ring itself says who is on move
  // for as long as it lasts, so this only has to catch the eye at the handover.
  const pingScale = useSharedValue(1);
  const pingOpacity = useSharedValue(0);
  const reduceMotion = usePrefersReducedMotion();
  const ping = useCallback(() => {
    "worklet";
    pingScale.set(1);
    pingOpacity.set(0.9);
    pingScale.set(withTiming(RING_PING_SCALE, { duration: Motion.duration.reveal, easing: Easing.out(Easing.cubic) }));
    pingOpacity.set(withTiming(0, { duration: Motion.duration.reveal, easing: Easing.out(Easing.quad) }));
  }, [pingScale, pingOpacity]);
  useEffect(() => {
    if (!isActive || reduceMotion) return;
    ping();
  }, [isActive, reduceMotion, ping]);
  const flash = mark?.flash;
  const own = mark?.seat ?? -1;
  // On the frame the exchange stepper writes it, not a render later.
  useAnimatedReaction(
    () => (flash && flash.value.seat === own ? flash.value.seq : -1),
    (seq, prev) => {
      if (seq >= 0 && prev !== null && seq !== prev && !reduceMotion) ping();
    }
  );
  const lit = isActive || mark?.lit === true;
  const probe = useRingProbe(name);

  useEffect(
    () => () => {
      cancelAnimation(pingScale);
      cancelAnimation(pingOpacity);
    },
    [pingScale, pingOpacity]
  );

  const pingStyle = useAnimatedStyle(() => ({
    opacity: pingOpacity.value,
    transform: [{ scale: pingScale.value }],
  }));

  // Focus mode strips every other turn signal off the felt, so the ring on
  // move has to carry that on its own — a slow breathe, on a loop for as
  // long as the turn lasts, not a one-shot like the ping above.
  const breathe = useSharedValue(0);
  const breathing = isActive && focusMode && !reduceMotion;
  useEffect(() => {
    if (!breathing) {
      cancelAnimation(breathe);
      breathe.value = 0;
      return;
    }
    breathe.value = withRepeat(
      withTiming(1, { duration: BREATHE_MS / 2, easing: Easing.inOut(Easing.sin) }),
      -1,
      true
    );
    return () => cancelAnimation(breathe);
  }, [breathing, breathe]);
  const breatheStyle = useAnimatedStyle(() => ({
    opacity: isActive && focusMode ? interpolate(breathe.value, [0, 1], [0.35, 1]) : 0,
  }));

  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const size = SEAT_DISC * scale;
  const lastCard = finishPos === undefined && cardCount === 1;
  const badge = SEAT_BADGE * (lastCard ? LAST_CARD_BADGE : 1) * scale;
  const showCount = finishPos !== undefined || !focusMode;
  return (
    <View ref={probe} testID="seat-ring" {...({ dataSet: { seatLit: String(lit) } } as ViewProps)} style={{ width: size, height: size }}>
      <Animated.View
        testID="seat-ring-ping"
        pointerEvents="none"
        style={[
          seatStyles.ringPing,
          { width: size, height: size, borderRadius: size / 2, borderWidth: RING_STROKE * scale },
          pingStyle,
        ]}
      />
      <Animated.View
        testID="seat-ring-breathe"
        pointerEvents="none"
        style={[
          { position: "absolute", width: size, height: size, borderRadius: size / 2 },
          makeShadow(Colors.goldLit, 0, 0, 0.6, BREATHE_GLOW * scale, 0),
          breatheStyle,
        ]}
      />
      <LinearGradient
        // The lamp is overhead and to the left of everything on this table.
        start={{ x: 0.3, y: 0.25 }}
        end={{ x: 1, y: 1 }}
        colors={SEAT_DISC_FILL}
        style={[
          seatStyles.disc,
          lit && seatStyles.discActive,
          { width: size, height: size, borderRadius: size / 2 },
          lit
            ? makeShadow(Colors.goldLit, 0, 0, 0.38, SEAT_GLOW * scale, 0)
            : makeShadow(Colors.shadow, 0, SEAT_SHADOW_Y * scale, 0.62, SEAT_SHADOW * scale, 0),
        ]}
      >
        <TableText style={[seatStyles.discInitials, { fontSize: tableFontSize(SEAT_INITIAL_FS, scale) }]}>
          {initials}
        </TableText>
      </LinearGradient>
      {countdown && isActive && (
        <CountdownRing
          size={size}
          seconds={countdown.seconds}
          resetKey={countdown.resetKey}
          scale={scale}
        />
      )}
      {showCount && (
        <View
          testID="seat-card-count"
          style={[
            seatStyles.countBubble,
            finishPos !== undefined && seatStyles.countBubbleFinished,
            lastCard && seatStyles.countBubbleLast,
            {
              minWidth: badge,
              height: badge,
              borderRadius: badge / 2,
              bottom: -RING_GAP * scale,
              right: -RING_GAP * scale,
            },
            lastCard && makeShadow(LastCard.glow, 0, 0, LAST_CARD_GLOW.opacity, mockupPx(LAST_CARD_GLOW.blur, scale) * LAST_CARD_BADGE, 0),
          ]}
        >
          {finishPos !== undefined ? (
            <Ionicons testID="seat-finish-trophy" name="trophy" size={badge * 0.5} color={Colors.gold} />
          ) : (
            <TableText
              style={[
                seatStyles.countBubbleText,
                lastCard && seatStyles.countBubbleTextLast,
                { fontSize: tableFontSize(SEAT_BADGE_FS, scale) },
              ]}
            >
              {cardCount}
            </TableText>
          )}
        </View>
      )}
    </View>
  );
}

// ─── SeatBadges ───────────────────────────────────────────────────────────────

function SeatBadges({
  vacated,
  reconnecting,
  name,
  scale,
  maxW,
}: {
  vacated: boolean;
  reconnecting?: { seconds: number; resetKey: string };
  name: string;
  scale: number;
  maxW: number;
}) {
  if (!vacated && !reconnecting) return null;
  return (
    <View style={[seatStyles.seatBadgeRow, { maxWidth: maxW }]}>
      {reconnecting && (
        <ReconnectingMark seconds={reconnecting.seconds} resetKey={reconnecting.resetKey} scale={scale} />
      )}
      {!reconnecting && vacated && <VacatedMark username={name} scale={scale} />}
    </View>
  );
}

// ─── TopOppSlot ───────────────────────────────────────────────────────────────

export function TopOppSlot({
  player,
  isActive,
  cardCount,
  passed = false,
  vacated = false,
  reconnecting,
  scale = 1,
  countdown,
  focusMode = false,
  dealArrivals,
  mark,
}: {
  player: Player;
  isActive: boolean;
  cardCount?: number;
  /** This seat has passed in the round on the table. */
  passed?: boolean;
  /** The seat is a human's that left, played on by the engine. */
  vacated?: boolean;
  /** The seat's own disconnect countdown, for the whole grace. */
  reconnecting?: { seconds: number; resetKey: string };
  /** The table's own scale — the seat's fan draws its backs at `scale * BACK_SCALE`. */
  scale?: number;
  /** The turn window, so the seat on move can sweep its own rim. */
  countdown?: { seconds: number; resetKey: string };
  /** Cards only: the name, the badges and the card count fall away. */
  focusMode?: boolean;
  /** While a deal runs, when each of this seat's cards lands — see useArrivedCount. */
  dealArrivals?: DealArrivals;
  mark?: SeatMark;
}) {
  const arrived = useArrivedCount(dealArrivals);
  const displayed = Math.min(cardCount ?? player.hand.length, arrived);
  const lit = isActive || mark?.lit === true;
  return (
    <View
      testID="top-seat"
      style={[
        seatStyles.topOppSlot,
        { paddingTop: seatLabelH(scale), gap: seatGap(scale) },
        !!reconnecting && seatStyles.seatDim,
      ]}
    >
      <SeatWho
        name={player.name}
        isActive={isActive}
        count={displayed}
        finishPos={player.finishPosition}
        passed={passed}
        vacated={vacated}
        reconnecting={reconnecting}
        scale={scale}
        countdown={countdown}
        focusMode={focusMode}
        mark={mark}
      />
      {player.finishPosition === undefined && displayed > 0 && (
        <CardFan count={displayed} side="top" isActive={lit} scale={scale} />
      )}
    </View>
  );
}

// ─── SeatWho ──────────────────────────────────────────────────────────────────

/**
 * A seat's avatar with its name and badges floating above it, out of flow.
 * Out of flow is the point: the label is the only part of a seat whose height
 * varies, and in flow it would push the fan a different distance from the ring
 * on the seat that happens to carry a bot badge — so the ring-to-fan gap has
 * to be the same number on all three seats, or it is guesswork.
 */
function SeatWho({
  name,
  isActive,
  count,
  finishPos,
  passed,
  vacated = false,
  reconnecting,
  scale,
  countdown,
  anchor = "centre",
  focusMode = false,
  mark,
}: {
  name: string;
  isActive: boolean;
  mark?: SeatMark;
  count: number;
  finishPos?: number;
  passed: boolean;
  /** The seat is a human's that left, played on by the engine. */
  vacated?: boolean;
  /** The seat's own disconnect countdown, for the whole grace. */
  reconnecting?: { seconds: number; resetKey: string };
  scale: number;
  countdown?: { seconds: number; resetKey: string };
  /**
   * Which of the label's edges is pinned to the disc. The top seat has the
   * whole table to spread into and centres; a side seat sits flush against its
   * own column, so a label centred there hangs off the screen.
   */
  anchor?: "centre" | "left" | "right";
  focusMode?: boolean;
}) {
  const disc = SEAT_DISC * scale;
  const labelW = anchor === "centre" ? OPP_LABEL_MAX_W * scale : SIDE_LABEL_MAX_W;
  const labelLeft =
    anchor === "centre" ? (disc - labelW) / 2 : anchor === "left" ? 0 : disc - labelW;
  return (
    <View style={seatStyles.who}>
      {!focusMode && (
        <View
          style={[
            seatStyles.whoLabel,
            {
              width: labelW,
              left: labelLeft,
              bottom: disc,
              gap: SEAT_LABEL_GAP * scale,
              paddingBottom: SEAT_LABEL_PAD * scale,
            },
            anchor === "left" && seatStyles.whoLabelLeft,
            anchor === "right" && seatStyles.whoLabelRight,
          ]}
          pointerEvents="none"
        >
          <TableText
            testID="seat-name"
            style={[
              seatStyles.oppName,
              // The cap rides the scale the glyphs do; fixed, it ellipsises
              // every name above a phone's own scale.
              { fontSize: tableFontSize(SEAT_NAME_FS, scale), maxWidth: labelW },
              (isActive || mark?.lit) && seatStyles.oppNameActive,
            ]}
            numberOfLines={1}
          >
            {name}
          </TableText>
          <SeatBadges
            vacated={vacated}
            reconnecting={reconnecting}
            name={name}
            scale={scale}
            maxW={labelW}
          />
        </View>
      )}
      <SeatRing
        name={name}
        isActive={isActive}
        cardCount={count}
        finishPos={finishPos}
        scale={scale}
        countdown={countdown}
        focusMode={focusMode}
        mark={mark}
      />
      {passed && !focusMode && <PassedMark side={anchor === "centre" ? "top" : "side"} disc={disc} scale={scale} />}
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
  vacated = false,
  reconnecting,
  scale = 1,
  countdown,
  focusMode = false,
  dealArrivals,
  mark,
}: {
  player: Player;
  isActive: boolean;
  mark?: SeatMark;
  side: "left" | "right";
  cardCount?: number;
  /** This seat has passed in the round on the table. */
  passed?: boolean;
  /** The seat is a human's that left, played on by the engine. */
  vacated?: boolean;
  /** The seat's own disconnect countdown, for the whole grace. */
  reconnecting?: { seconds: number; resetKey: string };
  /** The table's own scale — the seat's fan draws its backs at `scale * BACK_SCALE`. */
  scale?: number;
  /** The turn window, so the seat on move can sweep its own rim. */
  countdown?: { seconds: number; resetKey: string };
  /** Cards only: the name, the badges and the card count fall away. */
  focusMode?: boolean;
  /** While a deal runs, when each of this seat's cards lands — see useArrivedCount. */
  dealArrivals?: DealArrivals;
}) {
  const arrived = useArrivedCount(dealArrivals);
  const displayed = Math.min(cardCount ?? player.hand.length, arrived);
  const isLeft = side === "left";
  const lit = isActive || mark?.lit === true;
  return (
    <View
      testID={`side-seat-${side}`}
      style={[
        seatStyles.sideOppSlot,
        { gap: seatGap(scale) },
        isLeft ? seatStyles.sideLeft : seatStyles.sideRight,
        !!reconnecting && seatStyles.seatDim,
      ]}
    >
      <SeatWho
        name={player.name}
        isActive={isActive}
        count={displayed}
        finishPos={player.finishPosition}
        passed={passed}
        vacated={vacated}
        reconnecting={reconnecting}
        scale={scale}
        countdown={countdown}
        anchor={isLeft ? "left" : "right"}
        focusMode={focusMode}
        mark={mark}
      />
      {displayed > 0 && player.finishPosition === undefined && (
        <CardFan count={displayed} side={side} isActive={lit} scale={scale} />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/**
 * Wide enough for a name the length of the longest the lobby deals in, at
 * `SEAT_NAME_FS` with its own tracking and the plate's padding either side.
 * At 70 the plate ellipsised "Besnik" to "BE…", which reads as a bug rather
 * than as a long name being trimmed.
 */
const OPP_LABEL_MAX_W = 104 + Spacing.xs * 2;
/**
 * …and what a side seat gets, in points rather than a multiple of the scale: a
 * label measured in scaled points outgrows its fixed column on a big screen and
 * is drawn off the edge of it, which is what tests/e2e/tableFit.spec.ts caught.
 *
 * Wider than `SIDE_SECTION_W`, and not derived from it. The plate leans inward
 * over the felt the way the fan does (`whoLabelLeft`), so the column is not its
 * bound — while the floor above is real: at 80 this ellipsises "Besnik".
 */
const SIDE_LABEL_MAX_W = 114;
/** How far a seat recedes while its player is reconnecting. */
const SEAT_DIM_OPACITY = 0.62;
/** The count badge's own diameter, and the digit inside it, at scale 1. */
const SEAT_BADGE = 18;
const SEAT_BADGE_FS = 10;
const LAST_CARD_BADGE = 1.25;
/** `.badge.last`'s glow in mockup px, before the badge's own growth. */
const LAST_CARD_GLOW = { blur: 10, opacity: 0.6 } as const;
const SEAT_NAME_FS = 11;
/** The disc's seated shadow, and the glow that replaces it on the seat on move. */
const SEAT_SHADOW = 9;
const SEAT_SHADOW_Y = 3;
const SEAT_GLOW = 22;
/** The initial in the middle of the disc. */
const SEAT_INITIAL_FS = 13;
const SEAT_DISC_FILL = [Colors.seatDisc, Colors.seatDiscDeep] as const;

const seatStyles = StyleSheet.create({
  // The fan sits between the player and the table, never above them: the top
  // seat stacks avatar-then-fan down the screen, and each side seat is the
  // same construction turned a quarter. The gap is one number for all three,
  // and it rides the table's scale, so it is passed in rather than set here.
  topOppSlot: {
    alignItems: "center",
    justifyContent: "flex-start",
  },
  sideOppSlot: { alignItems: "center", justifyContent: "center" },
  sideLeft: { flexDirection: "row" },
  sideRight: { flexDirection: "row-reverse" },
  // Not far enough to cost the card count its legibility — that is the most
  // important thing on the seat.
  seatDim: { opacity: SEAT_DIM_OPACITY },

  who: { alignItems: "center", justifyContent: "center" },
  // Out of flow, so a badge cannot lengthen the column and move the fan. The
  // caller supplies width and both insets in points, worked out from the disc
  // it hangs over — centring it on a percentage translate instead leaves the
  // label beside the disc on any renderer that does not resolve one.
  // The gap and the pad ride the table's scale, so they are passed in rather
  // than set here — `seatLabelH` reserves this column's height from the same
  // two numbers, and a flat length here is height it would not know about.
  whoLabel: {
    position: "absolute",
    alignItems: "center",
  },
  // A side seat's label runs inwards from the disc, into the felt, rather than
  // outwards past the edge its own column is flush against.
  whoLabelLeft: { alignItems: "flex-start" },
  whoLabelRight: { alignItems: "flex-end" },

  // The same glass as the HUD chips. The lamp can stand directly over any seat,
  // and on the felt's lit band the label alone does not clear AA.
  oppName: {
    fontFamily: "Rajdhani_600SemiBold",
    color: Colors.textMuted,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    maxWidth: OPP_LABEL_MAX_W,
    textAlign: "center",
    backgroundColor: Colors.chipFill,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.xs,
    // No `overflow: hidden`. The plate is this element's own background and
    // has no children to clip, so the only thing it ever cut off was the
    // label's own glyphs once the OS text setting grew them past the line box
    // this element was sized for.
  },
  oppNameActive: { color: Colors.goldLit },

  seatBadgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    maxWidth: OPP_LABEL_MAX_W,
    gap: Spacing.xs,
  },

  disc: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.goldSoft,
  },
  discActive: { borderColor: Colors.goldLit },
  discInitials: {
    fontFamily: "Rajdhani_700Bold",
    color: Colors.text,
    letterSpacing: 0.5,
  },
  ring: { position: "absolute", top: 0 },
  ringClip: { position: "absolute", top: 0, overflow: "hidden" },
  ringPing: {
    position: "absolute",
    borderColor: Colors.goldStrong,
  },
  countBubble: {
    position: "absolute",
    backgroundColor: Colors.seatBadge,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xxs,
    borderWidth: 1,
    borderColor: Colors.goldStrong,
  },
  countBubbleFinished: {
    backgroundColor: Colors.goldMuted,
    borderColor: Colors.gold,
  },
  countBubbleText: {
    fontFamily: "Rajdhani_700Bold",
    color: Colors.gold,
    fontVariant: ["tabular-nums"],
  },
  countBubbleLast: {
    backgroundColor: LastCard.fill,
    borderColor: LastCard.edge,
  },
  countBubbleTextLast: {
    color: LastCard.ink,
  },
});
