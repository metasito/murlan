import { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import { TableText } from "./TableText";
import { ChipText, TableChip } from "./chrome";
import { CHIP_H } from "@/components/gameTableModel";
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
  cancelAnimation,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { CardView } from "@/components/CardView";
import { arcBounds, SEAT_ARC, solveArc } from "@/components/tableArc";
import type { OpponentSide } from "@/components/gameTableModel";
import { CARD_BACK_H, CARD_BACK_W, BACK_SCALE } from "@/components/cardFaceModel";
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

function CardFan({
  count,
  side,
  isActive,
  scale = 1,
}: {
  count: number;
  side: OpponentSide;
  /** This seat is on move, so the lamp is over it and its backs are lit. */
  isActive: boolean;
  /** The table's own scale — the fan draws its backs at `scale * BACK_SCALE`. */
  scale?: number;
}) {
  if (count === 0) return null;
  const backScale = scale * BACK_SCALE;
  const backW = CARD_BACK_W(backScale);
  const backH = CARD_BACK_H(backScale);
  // A fan is never width-budgeted: the seat's own column bounds it, and it is
  // the rise that actually binds.
  const { cards, box } = solveArc(count, {
    budget: SEAT_ARC,
    cardW: backW,
    cardH: backH,
    scale: backScale,
    room: Infinity,
    flip: true,
  });
  const bounds = arcBounds(cards, box, backW, backH);

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
          width: box.w,
          height: box.h,
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
        {cards.map((card, i) => (
          <View
            key={i}
            style={{
              position: "absolute",
              left: box.w / 2 + card.x,
              top: card.y,
              transform: [{ rotate: `${card.rot}deg` }],
              zIndex: i,
            }}
          >
            <CardView
              card={{ id: `bk${i}`, suit: null, rank: "3", isJoker: false }}
              faceDown
              scale={backScale}
              light={isActive ? "standingLit" : "standing"}
            />
          </View>
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

/** The disc's diameter at scale 1. Everything else on the seat derives from it. */
const SEAT_DISC = 33;
/** How far the countdown ring stands off the disc, and how thick it is drawn. */
const RING_GAP = 4;
const RING_STROKE = 2;
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

function SeatRing({
  name,
  isActive,
  cardCount,
  finishPos,
  scale,
  countdown,
}: {
  name: string;
  isActive: boolean;
  cardCount: number;
  finishPos?: number;
  scale: number;
  /** The turn window, on the seat that is on move. Absent on every other seat. */
  countdown?: { seconds: number; resetKey: string };
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
      duration: Motion.duration.slow,
      easing: Easing.out(Easing.cubic),
    });
    pingOpacity.value = withTiming(0, {
      duration: Motion.duration.slow,
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
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const size = SEAT_DISC * scale;
  const badge = SEAT_BADGE * scale;
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
      <View
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
function SeatBadges({ passed, scale }: { passed: boolean; scale: number }) {
  if (!passed) return null;
  return (
    <View style={[seatStyles.seatBadgeRow, { maxWidth: OPP_LABEL_MAX_W * scale }]}>
      <PassedChip scale={scale} />
    </View>
  );
}

// ─── TopOppSlot ───────────────────────────────────────────────────────────────

export function TopOppSlot({
  player,
  isActive,
  cardCount,
  passed = false,
  scale = 1,
  countdown,
}: {
  player: Player;
  isActive: boolean;
  cardCount?: number;
  /** This seat has passed in the round on the table. */
  passed?: boolean;
  /** The table's own scale — the seat's fan draws its backs at `scale * BACK_SCALE`. */
  scale?: number;
  /** The turn window, so the seat on move can sweep its own rim. */
  countdown?: { seconds: number; resetKey: string };
}) {
  const count = cardCount ?? player.hand.length;
  return (
    <View
      testID="top-seat"
      style={[
        seatStyles.topOppSlot,
        { paddingTop: seatLabelH(scale) },
        !isActive && seatStyles.seatDim,
      ]}
    >
      <SeatWho
        name={player.name}
        isActive={isActive}
        count={count}
        finishPos={player.finishPosition}
        passed={passed}
        scale={scale}
        countdown={countdown}
      />
      {player.finishPosition === undefined && count > 0 && (
        <CardFan count={count} side="top" isActive={isActive} scale={scale} />
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
}: {
  name: string;
  isActive: boolean;
  count: number;
  finishPos?: number;
  passed: boolean;
  scale: number;
  countdown?: { seconds: number; resetKey: string };
}) {
  return (
    <View style={seatStyles.who}>
      <View
        style={[
          seatStyles.whoLabel,
          {
            width: OPP_LABEL_MAX_W * scale,
            left: ((SEAT_DISC - OPP_LABEL_MAX_W) * scale) / 2,
            bottom: SEAT_DISC * scale,
          },
        ]}
        pointerEvents="none"
      >
        <TableText
          style={[
            seatStyles.oppName,
            // The cap rides the scale the glyphs do; fixed, it ellipsises
            // every name above a phone's own scale.
            { fontSize: SEAT_NAME_FS * scale, maxWidth: OPP_LABEL_MAX_W * scale },
            isActive && seatStyles.oppNameActive,
          ]}
          numberOfLines={1}
        >
          {name}
        </TableText>
        <SeatBadges passed={passed} scale={scale} />
      </View>
      <SeatRing
        name={name}
        isActive={isActive}
        cardCount={count}
        finishPos={finishPos}
        scale={scale}
        countdown={countdown}
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
  passed = false,
  scale = 1,
  countdown,
}: {
  player: Player;
  isActive: boolean;
  side: "left" | "right";
  cardCount?: number;
  /** This seat has passed in the round on the table. */
  passed?: boolean;
  /** The table's own scale — the seat's fan draws its backs at `scale * BACK_SCALE`. */
  scale?: number;
  /** The turn window, so the seat on move can sweep its own rim. */
  countdown?: { seconds: number; resetKey: string };
}) {
  const count = cardCount ?? player.hand.length;
  const isLeft = side === "left";
  return (
    <View
      testID={`side-seat-${side}`}
      style={[
        seatStyles.sideOppSlot,
        isLeft ? seatStyles.sideLeft : seatStyles.sideRight,
        !isActive && seatStyles.seatDim,
      ]}
    >
      <SeatWho
        name={player.name}
        isActive={isActive}
        count={count}
        finishPos={player.finishPosition}
        passed={passed}
        scale={scale}
        countdown={countdown}
      />
      {count > 0 && player.finishPosition === undefined && (
        <CardFan count={count} side={side} isActive={isActive} scale={scale} />
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
/** Ring to fan, the same on every seat — see SeatWho. */
const SEAT_GAP = Spacing.slim;
/** How far a seat recedes while another one is on move. */
const SEAT_DIM_OPACITY = 0.62;
/**
 * The band the floating label needs above the avatar. The top seat sits
 * against the felt's own top edge, so without it the name and the badges are
 * drawn off the felt and behind the top bar. A constant, not the label's own
 * height: reserving what it actually measures would put the fan back at the
 * mercy of whether this seat happens to carry a bot badge.
 */
/**
 * The band the floating label needs above the disc: the name's own line, plus
 * the badge row, which is a chip and therefore scales with the table. A fixed
 * number here is the top seat's name drawn off the top of the screen — the
 * column reserves this, and only the top seat has a screen edge above it.
 */
function seatLabelH(scale: number): number {
  return SEAT_NAME_LINE * scale + CHIP_H(scale) + Spacing.xs;
}
const SEAT_NAME_LINE = 17;
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
  // same construction turned a quarter. The gap is one number for all three.
  topOppSlot: {
    alignItems: "center",
    justifyContent: "flex-start",
    gap: SEAT_GAP,
  },
  sideOppSlot: { alignItems: "center", justifyContent: "center", gap: SEAT_GAP },
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
