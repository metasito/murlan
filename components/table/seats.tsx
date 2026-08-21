import { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import { TableText } from "./TableText";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
  cancelAnimation,
} from "react-native-reanimated";
import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { CardView } from "@/components/CardView";
import { arcBounds, SEAT_ARC, solveArc } from "@/components/tableArc";
import type { OpponentSide } from "@/components/gameTableModel";
import { CARD_BACK_H, CARD_BACK_W, BACK_SCALE } from "@/components/cardFaceModel";
import { Colors, FontSize, Highlight, Motion, Radius, Scrim, Shadow, Spacing } from "@/lib/theme";
import { useTableFelt } from "@/lib/cosmetics";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useTranslation } from "@/lib/i18n";
import type { Player } from "@/lib/gameEngine";
import { a11yHidden } from "@/lib/a11y";

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
  scale = 1,
}: {
  count: number;
  side: OpponentSide;
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
            />
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── AvatarCircle ─────────────────────────────────────────────────────────────

function AvatarCircle({
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
          seatStyles.avatarPing,
          { width: outerSize, height: outerSize, borderRadius: outerSize / 2 },
          pingStyle,
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          seatStyles.avatarRing,
          { width: outerSize, height: outerSize, borderRadius: outerSize / 2 },
          ringStyle,
        ]}
      />
      <View
        style={[
          seatStyles.avatarOuter,
          { width: outerSize, height: outerSize, borderRadius: outerSize / 2 },
        ]}
      >
        <LinearGradient
          colors={[felt[1], felt[3]]}
          style={[
            seatStyles.avatarInner,
            { width: size, height: size, borderRadius: size / 2 },
          ]}
        >
          <TableText style={[seatStyles.avatarInitials, { fontSize: size * 0.36 }]}>
            {initials}
          </TableText>
        </LinearGradient>
        <View style={[
          seatStyles.countBubble,
          finishPos !== undefined && seatStyles.countBubbleFinished,
        ]}>
          {finishPos !== undefined ? (
            <Ionicons name="trophy" size={8} color={Colors.gold} />
          ) : (
            <TableText style={seatStyles.countBubbleText}>{cardCount}</TableText>
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
    <View style={seatStyles.botBadge}>
      <Ionicons
        name="hardware-chip-outline"
        size={FontSize.xs}
        color={Colors.gold}
        {...a11yHidden()}
      />
      <TableText style={seatStyles.botBadgeText}>{t("onlineGame.botSeatLabel")}</TableText>
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
    <View style={seatStyles.passedChip}>
      <TableText style={seatStyles.passedChipText}>{t("gameShared.passedLabel")}</TableText>
    </View>
  );
}

// Both markers share one wrapping row. A seat carrying both would otherwise
// stand two badge heights taller than one carrying neither.
function SeatBadges({ passed, isBot }: { passed: boolean; isBot: boolean }) {
  if (!passed && !isBot) return null;
  return (
    <View style={seatStyles.seatBadgeRow}>
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
  scale = 1,
}: {
  player: Player;
  isActive: boolean;
  cardCount?: number;
  /** This seat has passed in the round on the table. */
  passed?: boolean;
  /** The table's own scale — the seat's fan draws its backs at `scale * BACK_SCALE`. */
  scale?: number;
}) {
  const count = cardCount ?? player.hand.length;
  return (
    <View style={seatStyles.topOppSlot} testID="top-seat">
      <SeatWho
        name={player.name}
        isActive={isActive}
        count={count}
        finishPos={player.finishPosition}
        passed={passed}
        isBot={player.type === "ai"}
        size={42}
      />
      {player.finishPosition === undefined && count > 0 && (
        <CardFan count={count} side="top" scale={scale} />
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
  isBot,
  size,
}: {
  name: string;
  isActive: boolean;
  count: number;
  finishPos?: number;
  passed: boolean;
  isBot: boolean;
  size: number;
}) {
  return (
    <View style={seatStyles.who}>
      <View style={seatStyles.whoLabel} pointerEvents="none">
        <TableText style={seatStyles.oppName} numberOfLines={1}>
          {name}
        </TableText>
        <SeatBadges passed={passed} isBot={isBot} />
      </View>
      <AvatarCircle
        name={name}
        isActive={isActive}
        cardCount={count}
        finishPos={finishPos}
        size={size}
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
}: {
  player: Player;
  isActive: boolean;
  side: "left" | "right";
  cardCount?: number;
  /** This seat has passed in the round on the table. */
  passed?: boolean;
  /** The table's own scale — the seat's fan draws its backs at `scale * BACK_SCALE`. */
  scale?: number;
}) {
  const count = cardCount ?? player.hand.length;
  const isLeft = side === "left";
  return (
    <View
      testID={`side-seat-${side}`}
      style={[
        seatStyles.sideOppSlot,
        isLeft ? seatStyles.sideLeft : seatStyles.sideRight,
      ]}
    >
      <SeatWho
        name={player.name}
        isActive={isActive}
        count={count}
        finishPos={player.finishPosition}
        passed={passed}
        isBot={player.type === "ai"}
        size={40}
      />
      {count > 0 && player.finishPosition === undefined && (
        <CardFan count={count} side={side} scale={scale} />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const OPP_LABEL_MAX_W = 70 + Spacing.xs * 2;
/** Ring to fan, the same on every seat — see SeatWho. */
const SEAT_GAP = Spacing.slim;
/**
 * The band the floating label needs above the avatar. The top seat sits
 * against the felt's own top edge, so without it the name and the badges are
 * drawn off the felt and behind the top bar. A constant, not the label's own
 * height: reserving what it actually measures would put the fan back at the
 * mercy of whether this seat happens to carry a bot badge.
 */
const SEAT_LABEL_H = 32;

const seatStyles = StyleSheet.create({
  // The fan sits between the player and the table, never above them: the top
  // seat stacks avatar-then-fan down the screen, and each side seat is the
  // same construction turned a quarter. The gap is one number for all three.
  topOppSlot: {
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: SEAT_LABEL_H,
    gap: SEAT_GAP,
  },
  sideOppSlot: { alignItems: "center", justifyContent: "center", gap: SEAT_GAP },
  sideLeft: { flexDirection: "row" },
  sideRight: { flexDirection: "row-reverse" },

  who: { alignItems: "center", justifyContent: "center" },
  // Out of flow, so a bot badge cannot lengthen the column and move the fan.
  whoLabel: {
    position: "absolute",
    bottom: "100%",
    alignItems: "center",
    gap: Spacing.xxs,
    paddingBottom: Spacing.xs,
  },

  // The count bubble's plate. The top seat renders in the felt gradient's
  // lightest band, where textMuted alone does not clear AA.
  oppName: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: FontSize.xxs,
    color: Colors.textMuted,
    maxWidth: OPP_LABEL_MAX_W,
    textAlign: "center",
    backgroundColor: Colors.overlayStrong,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.xs,
    overflow: "hidden",
  },

  seatBadgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    maxWidth: OPP_LABEL_MAX_W,
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
    borderRadius: Radius.full,
    minWidth: 18,
    height: 18,
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
    fontSize: FontSize.xxs,
    color: Colors.gold,
  },
});
