import { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import { TableText } from "./TableText";
import { ChipText, TableChip } from "./chrome";
import {
  FAN_DRAWN_CARDS,
  SEAT_DISC,
  seatGap,
  displayedHandCount,
  fanCounts,
  impactDelayMs,
  seatFanArc,
  seatLabelH,
} from "@/components/gameTableModel";
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withRepeat,
  interpolate,
  Easing,
  cancelAnimation,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { CardView } from "@/components/CardView";
import type { ArcCard } from "@/components/tableArc";
import type { OpponentSide } from "@/components/gameTableModel";
import { BACK_SCALE } from "@/components/cardFaceModel";
import { Colors, makeShadow, Motion, Radius, Spacing } from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useTranslation } from "@/lib/i18n";
import type { Player } from "@/lib/gameEngine";

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

/** A quarter turn per side, so one construction serves all three seats. */
const FAN_TURN: Record<OpponentSide, number> = { top: 0, left: -90, right: 90 };

/**
 * How far a departing back lifts (deg 1, points at scale 1) while it fades,
 * so the exit reads as a card leaving rather than a count ticking down.
 */
const FAN_EXIT_LIFT = 14;

/** A remaining back eases toward `to`; a departing one lifts and fades in place. */
type FanDest = { departing: true } | { departing: false; to: ArcCard };

/**
 * One back, positioned as a `transform` throughout — including the static
 * case — so an exit or a re-solve is never anything but a change to a shared
 * value already being read every frame. `from` is where every back in this
 * fan sits until a departure begins.
 */
function FanBack({
  from,
  dest,
  progress,
  boxW,
  backScale,
  liftPx,
  isActive,
  zIndex,
}: {
  from: ArcCard;
  dest: FanDest;
  /** 0 at the throw's first frame, 1 once it has landed. */
  progress: SharedValue<number>;
  boxW: number;
  backScale: number;
  liftPx: number;
  isActive: boolean;
  zIndex: number;
}) {
  const aStyle = useAnimatedStyle(() => {
    const t = progress.value;
    if (dest.departing) {
      return {
        opacity: 1 - t,
        transform: [
          { translateX: boxW / 2 + from.x },
          { translateY: from.y - liftPx * t },
          { rotate: `${from.rot}deg` },
        ],
      };
    }
    const { to } = dest;
    return {
      opacity: 1,
      transform: [
        { translateX: boxW / 2 + from.x + (to.x - from.x) * t },
        { translateY: from.y + (to.y - from.y) * t },
        { rotate: `${from.rot + (to.rot - from.rot) * t}deg` },
      ],
    };
  });

  return (
    <Animated.View
      testID={dest.departing ? "seat-back-departing" : "seat-back"}
      style={[{ position: "absolute", zIndex }, aStyle]}
    >
      <CardView
        card={{ id: "bk", suit: null, rank: "3", isJoker: false }}
        faceDown
        scale={backScale}
        light={isActive ? "standingLit" : "standing"}
      />
    </Animated.View>
  );
}

function CardFan({
  count,
  departing = 0,
  side,
  isActive,
  scale = 1,
}: {
  /** The seat's displayed count — `handCountOf` plus whatever is in flight. */
  count: number;
  /**
   * How many of `count` are mid-flight and should lift and fade out of the
   * fan rather than sit in it. `displayedHandCount`'s own two-term sum is
   * what this and `count` come from, so the fan can never draw more backs
   * than the badge claims or fewer than the flight is actually carrying.
   */
  departing?: number;
  side: OpponentSide;
  /** This seat is on move, so the lamp is over it and its backs are lit. */
  isActive: boolean;
  /** The table's own scale — the fan draws its backs at `scale * BACK_SCALE`. */
  scale?: number;
}) {
  // Every hook above and below runs unconditionally, before the early return
  // past them: count can go from a real hand to 0 (a player going out) on any
  // render, and a hook called only on some of those renders is exactly the
  // "changed order" React refuses to tolerate.
  const reduceMotion = usePrefersReducedMotion();
  const { remaining, departing: cappedDeparting } = fanCounts(count, departing, FAN_DRAWN_CARDS[side]);
  const cappedTotal = remaining + cappedDeparting;
  const hasDeparture = cappedDeparting !== 0;

  const progress = useSharedValue(hasDeparture ? 0 : 1);
  useEffect(() => {
    if (!hasDeparture) {
      progress.value = 1;
      return;
    }
    progress.value = 0;
    progress.value = withTiming(1, { duration: impactDelayMs(reduceMotion) });
    return () => cancelAnimation(progress);
  }, [hasDeparture, reduceMotion, progress]);

  if (count === 0) return null;

  const backScale = scale * BACK_SCALE;
  // A fan is never width-budgeted: the seat's own column bounds it, and it is
  // the rise that actually binds. `full` is where every back — remaining and
  // departing alike — sits until a departure resolves; `settled` is only
  // where the *remaining* ones are headed, one solve for a smaller count
  // rather than a hand-picked subset of the larger one, which is what keeps
  // the step between them from reading as a jump.
  const full = seatFanArc(cappedTotal, backScale);
  const settled = cappedDeparting === 0 ? full : seatFanArc(remaining, backScale);
  const bounds = full.bounds;

  // The wrapper is what the cards occupy once turned, so the seat's own row or
  // column reserves exactly that and the ring-to-fan gap is one number on all
  // three seats.
  const turn = FAN_TURN[side];
  const wrapW = turn === 0 ? bounds.w : bounds.h;
  const wrapH = turn === 0 ? bounds.h : bounds.w;
  const liftPx = FAN_EXIT_LIFT * backScale;

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
          <FanBack
            key={i}
            from={card}
            dest={i < remaining ? { departing: false, to: settled.cards[i] } : { departing: true }}
            progress={progress}
            boxW={full.box.w}
            backScale={backScale}
            liftPx={liftPx}
            isActive={isActive}
            zIndex={i}
          />
        ))}
      </View>
    </View>
  );
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

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

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
  const circumference = 2 * Math.PI * r;
  const swept = useSharedValue(0);
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    swept.value = 0;
    if (reduceMotion) return;
    swept.value = withTiming(1, { duration: seconds * 1000, easing: Easing.linear });
    return () => cancelAnimation(swept);
  }, [resetKey, seconds, reduceMotion, swept]);

  const arc = useAnimatedProps(() => ({
    strokeDashoffset: circumference * swept.value,
  }));

  return (
    <Svg
      testID="seat-turn-clock"
      pointerEvents="none"
      width={box}
      height={box}
      style={[seatStyles.ringSvg, { top: -RING_GAP * scale, left: -RING_GAP * scale }]}
    >
      <AnimatedCircle
        cx={box / 2}
        cy={box / 2}
        r={r}
        stroke={Colors.goldLit}
        strokeWidth={stroke}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={circumference}
        animatedProps={arc}
        // Twelve o'clock, clockwise — a clock face, not an arbitrary sweep.
        transform={`rotate(-90 ${box / 2} ${box / 2})`}
      />
    </Svg>
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
}) {
  // One shot when the seat takes the turn: the ring itself says who is on move
  // for as long as it lasts, so this only has to catch the eye at the handover.
  const pingScale = useSharedValue(1);
  const pingOpacity = useSharedValue(0);
  const reduceMotion = usePrefersReducedMotion();
  useEffect(() => {
    if (!isActive || reduceMotion) return;
    pingScale.value = 1;
    pingOpacity.value = 0.9;
    pingScale.value = withTiming(RING_PING_SCALE, {
      duration: Motion.duration.reveal,
      easing: Easing.out(Easing.cubic),
    });
    pingOpacity.value = withTiming(0, {
      duration: Motion.duration.reveal,
      easing: Easing.out(Easing.quad),
    });
  }, [isActive, reduceMotion, pingScale, pingOpacity]);

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
  const badge = SEAT_BADGE * scale;
  const showCount = finishPos !== undefined || !focusMode;
  return (
    <View testID="seat-ring" style={{ width: size, height: size }}>
      <Animated.View
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
          isActive && seatStyles.discActive,
          { width: size, height: size, borderRadius: size / 2 },
          isActive
            ? makeShadow(Colors.goldLit, 0, 0, 0.38, SEAT_GLOW * scale, 0)
            : makeShadow(Colors.shadow, 0, SEAT_SHADOW_Y * scale, 0.62, SEAT_SHADOW * scale, 0),
        ]}
      >
        <TableText style={[seatStyles.discInitials, { fontSize: SEAT_INITIAL_FS * scale }]}>
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
            {
              minWidth: badge,
              height: badge,
              borderRadius: badge / 2,
              bottom: -RING_GAP * scale,
              right: -RING_GAP * scale,
            },
          ]}
        >
          {finishPos !== undefined ? (
            <Ionicons name="trophy" size={badge * 0.5} color={Colors.gold} />
          ) : (
            <TableText style={[seatStyles.countBubbleText, { fontSize: SEAT_BADGE_FS * scale }]}>
              {cardCount}
            </TableText>
          )}
        </View>
      )}
    </View>
  );
}

// ─── SeatBadges ───────────────────────────────────────────────────────────────

// A pass leaves no trace on the felt, so this chip is the only thing that says
// a seat is out of the current round. It stands until somebody plays, which is
// when `passedSeats` (gameTableModel.ts) stops returning that seat. Deliberately
// quieter than the gold bot badge and the gold turn ring: a seat that has
// withdrawn from the round must not out-shout whose turn it is.
function PassedChip({ scale }: { scale: number }) {
  const { t } = useTranslation();
  return (
    <TableChip scale={scale}>
      <ChipText scale={scale}>{t("gameShared.passedLabel")}</ChipText>
    </TableChip>
  );
}

// Both markers share one wrapping row. A seat carrying both would otherwise
// stand two badge heights taller than one carrying neither.
function SeatBadges({ passed, scale, maxW }: { passed: boolean; scale: number; maxW: number }) {
  if (!passed) return null;
  return (
    <View style={[seatStyles.seatBadgeRow, { maxWidth: maxW }]}>
      <PassedChip scale={scale} />
    </View>
  );
}

// ─── TopOppSlot ───────────────────────────────────────────────────────────────

export function TopOppSlot({
  player,
  isActive,
  cardCount,
  departing = 0,
  passed = false,
  scale = 1,
  countdown,
  focusMode = false,
}: {
  player: Player;
  isActive: boolean;
  cardCount?: number;
  /** Cards this seat just threw that are still mid-flight — see displayedHandCount. */
  departing?: number;
  /** This seat has passed in the round on the table. */
  passed?: boolean;
  /** The table's own scale — the seat's fan draws its backs at `scale * BACK_SCALE`. */
  scale?: number;
  /** The turn window, so the seat on move can sweep its own rim. */
  countdown?: { seconds: number; resetKey: string };
  /** Cards only: the name, the badges and the card count fall away. */
  focusMode?: boolean;
}) {
  // The fan and the badge read one number, held at its pre-play value for as
  // long as the flight is up — see displayedHandCount.
  const displayed = displayedHandCount(cardCount ?? player.hand.length, departing);
  return (
    <View
      testID="top-seat"
      style={[
        seatStyles.topOppSlot,
        { paddingTop: seatLabelH(scale), gap: seatGap(scale) },
        !isActive && seatStyles.seatDim,
      ]}
    >
      <SeatWho
        name={player.name}
        isActive={isActive}
        count={displayed}
        finishPos={player.finishPosition}
        passed={passed}
        scale={scale}
        countdown={countdown}
        focusMode={focusMode}
      />
      {player.finishPosition === undefined && displayed > 0 && (
        <CardFan count={displayed} departing={departing} side="top" isActive={isActive} scale={scale} />
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
  scale,
  countdown,
  anchor = "centre",
  focusMode = false,
}: {
  name: string;
  isActive: boolean;
  count: number;
  finishPos?: number;
  passed: boolean;
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
            { width: labelW, left: labelLeft, bottom: disc },
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
              { fontSize: SEAT_NAME_FS * scale, maxWidth: labelW },
              isActive && seatStyles.oppNameActive,
            ]}
            numberOfLines={1}
          >
            {name}
          </TableText>
          <SeatBadges passed={passed} scale={scale} maxW={labelW} />
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
      />
    </View>
  );
}

// ─── SideOppSlot ──────────────────────────────────────────────────────────────

export function SideOppSlot({
  player,
  isActive,
  side,
  cardCount,
  departing = 0,
  passed = false,
  scale = 1,
  countdown,
  focusMode = false,
}: {
  player: Player;
  isActive: boolean;
  side: "left" | "right";
  cardCount?: number;
  /** Cards this seat just threw that are still mid-flight — see displayedHandCount. */
  departing?: number;
  /** This seat has passed in the round on the table. */
  passed?: boolean;
  /** The table's own scale — the seat's fan draws its backs at `scale * BACK_SCALE`. */
  scale?: number;
  /** The turn window, so the seat on move can sweep its own rim. */
  countdown?: { seconds: number; resetKey: string };
  /** Cards only: the name, the badges and the card count fall away. */
  focusMode?: boolean;
}) {
  const displayed = displayedHandCount(cardCount ?? player.hand.length, departing);
  const isLeft = side === "left";
  return (
    <View
      testID={`side-seat-${side}`}
      style={[
        seatStyles.sideOppSlot,
        { gap: seatGap(scale) },
        isLeft ? seatStyles.sideLeft : seatStyles.sideRight,
        !isActive && seatStyles.seatDim,
      ]}
    >
      <SeatWho
        name={player.name}
        isActive={isActive}
        count={displayed}
        finishPos={player.finishPosition}
        passed={passed}
        scale={scale}
        countdown={countdown}
        anchor={isLeft ? "left" : "right"}
        focusMode={focusMode}
      />
      {displayed > 0 && player.finishPosition === undefined && (
        <CardFan count={displayed} departing={departing} side={side} isActive={isActive} scale={scale} />
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
/** How far a seat recedes while another one is on move. */
const SEAT_DIM_OPACITY = 0.62;
/** The count badge's own diameter, and the digit inside it, at scale 1. */
const SEAT_BADGE = 18;
const SEAT_BADGE_FS = 10;
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
  // A seat that is not on move recedes, which is one of the four signals the
  // table gives about whose turn it is. Not far enough to cost the card count
  // its legibility — that is the most important thing on the seat.
  seatDim: { opacity: SEAT_DIM_OPACITY },

  who: { alignItems: "center", justifyContent: "center" },
  // Out of flow, so a badge cannot lengthen the column and move the fan. The
  // caller supplies width and both insets in points, worked out from the disc
  // it hangs over — centring it on a percentage translate instead leaves the
  // label beside the disc on any renderer that does not resolve one.
  whoLabel: {
    position: "absolute",
    alignItems: "center",
    gap: Spacing.xxs,
    paddingBottom: Spacing.xs,
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
  ringSvg: { position: "absolute" },
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
});
