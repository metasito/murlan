import { useEffect, useRef, type ReactNode } from "react";
import { View, StyleSheet, Pressable, type TextProps, type AccessibilityProps } from "react-native";
import { TableText } from "./TableText";
import {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  cancelAnimation,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import {
  Colors,
  FontSize,
  makeShadow,
  Radius,
  Reading,
  Scrim,
  Spacing,
  Type,
  Layer,
} from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useTranslation } from "@/lib/i18n";
import { a11yHidden, a11yState, A11yStatus } from "@/lib/a11y";
import type { Card, StartReason } from "@/lib/gameEngine";
import { getCardDisplayRank, getSuitSymbol } from "@/lib/gameEngine";
import { CHIP_H, SIDE_SECTION_W, type RailSide } from "@/components/gameTableModel";

// ─── StartReasonBanner ────────────────────────────────────────────────────────

/**
 * Who starts the manche, and why — held over the table for as long as it takes
 * to read it and no longer.
 *
 * It is a gate rather than a banner: it covers the table, so the first tap
 * spends itself clearing this instead of playing a card, and the caller stops
 * the turn clock while it is up (`turnTimerActive`, gameTableModel.ts) wherever
 * that clock is the client's own. The moment it describes is one seat's turn to
 * open, so the caller unmounts it the instant the table moves past that seat —
 * a message about who starts is worth nothing once someone has played.
 *
 * Under reduced motion the words are unchanged: the whole cue is text and a
 * lamp already pointed at it, never an animation carrying the meaning on its
 * own.
 */
export function StartReasonBanner({
  reason,
  players,
  onDone,
}: {
  reason: StartReason;
  players: { name: string; type: string }[];
  /** Told once, when the gate closes — by the clock or by the player. */
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  // Whether it is still up is the caller's to hold, not a second flag here:
  // the caller is also the one that knows when the moment being announced has
  // passed, and two answers to one question is how a gate comes back.
  useEffect(() => {
    const timer = setTimeout(() => doneRef.current(), Reading.notice);
    return () => clearTimeout(timer);
  }, []);

  const playerName = players[reason.playerIdx]?.name ?? "?";
  let mainText = "";
  let subText = "";

  if (reason.type === "start_card" && reason.card) {
    mainText = t("gameShared.startReasonCard", {
      name: playerName,
      rank: getCardDisplayRank(reason.card.rank),
      suit: getSuitSymbol(reason.card.suit),
    });
    const isThreeOfSpades = reason.card.rank === "3" && reason.card.suit === "spades";
    if (!isThreeOfSpades) subText = t("gameShared.startReasonCardSub");
  } else if (reason.type === "lost_round") {
    mainText = t("gameShared.startReasonLostRound", { name: playerName });
  } else if (reason.type === "won_no_swap") {
    mainText = t("gameShared.startReasonWonNoSwap", { name: playerName });
  }

  return (
    <>
      {/* Its own node, never the control: a live region announces rather than
          being landed on (CLAUDE.md), and the gate below is unreachable. */}
      <A11yStatus
        label={[mainText, subText].filter(Boolean).join(". ")}
        role="alert"
        live="assertive"
      />
      <Pressable
        testID="start-reason-gate"
        onPress={() => doneRef.current()}
        style={startReasonStyles.gate}
        {...a11yHidden()}
      >
        <View style={startReasonStyles.card}>
          <LinearGradient
            colors={[Colors.goldMuted, "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <TableText style={startReasonStyles.eyebrow}>
            {t("gameShared.startReasonEyebrow")}
          </TableText>
          <TableText style={startReasonStyles.main}>{mainText}</TableText>
          {subText ? <TableText style={startReasonStyles.sub}>{subText}</TableText> : null}
          <TableText style={startReasonStyles.hint}>
            {t("gameShared.startReasonDismiss")}
          </TableText>
        </View>
      </Pressable>
    </>
  );
}

/**
 * Over the table and its rail both, because holding the table is the point.
 * Under the settings sheet and every overlay, which are `Layer.sheet` and up.
 */
const START_REASON_Z = Layer.hint;
const START_REASON_MAX_W = 420;

const startReasonStyles = StyleSheet.create({
  gate: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Scrim.medium,
    zIndex: START_REASON_Z,
  },
  card: {
    backgroundColor: Colors.overlayStrong,
    borderColor: Colors.gold,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.cosy,
    alignItems: "center",
    maxWidth: START_REASON_MAX_W,
    gap: Spacing.xs,
    overflow: "hidden",
  },
  eyebrow: {
    ...Type.caption,
    color: Colors.goldDim,
    letterSpacing: 3,
    textTransform: "uppercase",
  },
  main: {
    ...Type.heading,
    color: Colors.goldLit,
    letterSpacing: 0.5,
    textAlign: "center",
  },
  sub: {
    ...Type.caption,
    color: Colors.textSecondary,
    textAlign: "center",
  },
  hint: {
    ...Type.caption,
    color: Colors.textMuted,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
});

// ─── HUD chips ────────────────────────────────────────────────────────────────
//
// The table's chrome is two chips over the felt, not a bar across the top: the
// combination on the felt at the head of the play area, and whose turn it is at
// the far corner. Nothing is ever drawn over the middle of the felt, which is
// where cards land.

/**
 * One chip. `lit` is the turn chip on the viewer's own turn — the only piece of
 * chrome the lamp reaches, and the reason it can be read at a glance.
 */
export function TableChip({
  scale,
  lit = false,
  children,
}: {
  scale: number;
  lit?: boolean;
  children: ReactNode;
}) {
  return (
    <View
      style={[
        chipStyles.chip,
        {
          height: CHIP_H(scale),
          paddingHorizontal: CHIP_PAD_H * scale,
          gap: CHIP_GAP * scale,
        },
        lit && chipStyles.chipLit,
        lit && makeShadow(Colors.goldLit, 0, 0, 0.32, CHIP_GLOW * scale, 0),
      ]}
    >
      {children}
    </View>
  );
}

/** A chip's own text: uppercase, letterspaced, dim. `strong` is the gold half. */
export function ChipText({
  scale,
  strong = false,
  lit = false,
  urgent = false,
  maxWidth,
  children,
  ...a11y
}: {
  scale: number;
  strong?: boolean;
  lit?: boolean;
  urgent?: boolean;
  /** Caps this run so an unbounded value (a username) ellipsizes instead of widening the chip. */
  maxWidth?: number;
  children: ReactNode;
} & Partial<Pick<TextProps, "accessibilityLabel" | "accessibilityLiveRegion">>) {
  return (
    <TableText
      numberOfLines={1}
      {...a11y}
      style={[
        chipStyles.chipLabel,
        {
          fontSize: FontSize.xxs * scale,
          // Tracking is `em` in the prototype, so it grows with the type it is
          // set in — a fixed px value is a different letterspacing per handset.
          letterSpacing: (strong ? CHIP_TRACKING_STRONG : CHIP_TRACKING) * scale,
        },
        strong && chipStyles.chipLabelStrong,
        lit && chipStyles.chipLabelLit,
        urgent && chipStyles.chipLabelUrgent,
        maxWidth !== undefined && { maxWidth: maxWidth * scale },
      ]}
    >
      {children}
    </TableText>
  );
}

/** The lit dot beside the turn chip's label. */
export function ChipDot({ scale, lit, testID }: { scale: number; lit: boolean; testID?: string }) {
  const size = CHIP_DOT * scale;
  return (
    <View
      testID={testID}
      style={[
        chipStyles.chipDot,
        { width: size, height: size, borderRadius: size / 2 },
        lit && chipStyles.chipDotLit,
        lit && makeShadow(Colors.goldLit, 0, 0, 0.7, CHIP_DOT_GLOW * scale, 0),
      ]}
    />
  );
}

const CHIP_PAD_H = 11;
const CHIP_GAP = 7;
const CHIP_DOT = 6;
const CHIP_GLOW = 20;
const CHIP_DOT_GLOW = 9;
// `.15em` and `.06em` of the chip's own `10 * s` type.
const CHIP_TRACKING = 1.5;
const CHIP_TRACKING_STRONG = 0.6;

/**
 * The top-left chip's name run, capped so a long username ellipsizes rather
 * than pushing the band wider than the felt has room for.
 */
export const CHIP_NAME_MAX_W = 88;

const chipStyles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.goldBorder,
    backgroundColor: Colors.chipFill,
  },
  chipLit: { borderColor: Colors.goldStrong },
  chipLabel: {
    fontFamily: "Rajdhani_600SemiBold",
    color: Colors.textMuted,
    textTransform: "uppercase",
  },
  chipLabelStrong: {
    fontFamily: "Rajdhani_700Bold",
    color: Colors.gold,
    fontVariant: ["tabular-nums"],
  },
  chipLabelLit: { color: Colors.goldLit },
  // FontSize.xxs, so tests/tokenRoles.test.ts bars Colors.danger here.
  chipLabelUrgent: { color: Colors.dangerDim },
  chipDot: { backgroundColor: Colors.textMuted },
  chipDotLit: { backgroundColor: Colors.goldLit },
});

// ─── Control rail ─────────────────────────────────────────────────────────────

/**
 * The column the device cutout occupies, turned into the table's control
 * column: `top` at the head, `bottom` at the foot, and the cutout in the gap
 * between them. Its width comes from `railWidth` (components/gameTableModel.ts),
 * which floors it well above a 44pt knob so a phone with no cutout lays out
 * exactly like one with a Dynamic Island.
 */
/** The rail stays reachable behind a layer that traps focus (lib/a11y.tsx). */
export const RAIL_TESTID = "control-rail";

export function ControlRail({
  width,
  side,
  topPad,
  bottomPad,
  top,
  bottom,
  veiled,
}: {
  width: number;
  /** The edge the cutout is on, from the frame (components/gameTableModel.ts). */
  side: RailSide;
  topPad: number;
  bottomPad: number;
  top?: ReactNode;
  bottom?: ReactNode;
  /**
   * The rail answers to a cover that paints over it, and deliberately not to
   * the settings sheet — the sheet is closed by the knob on this rail, so
   * veiling it there would shut the reader inside with no way out.
   */
  veiled?: AccessibilityProps;
}) {
  return (
    <View
      testID={RAIL_TESTID}
      style={[
        railStyles.rail,
        { width, paddingTop: topPad, paddingBottom: bottomPad, [side]: 0 },
      ]}
      {...veiled}
    >
      <View>{top}</View>
      <View>{bottom}</View>
    </View>
  );
}

/**
 * One knob on the rail. `size` is `physicalTouchTarget(scale)`
 * (components/cardFaceModel.ts) — a touch target's floor is physical size, so
 * it grows with the table's scale but never shrinks below 44pt.
 */
export function RailKnob({
  onPress,
  a11yLabel,
  size,
  expanded,
  testID,
  children,
}: {
  onPress: () => void;
  a11yLabel: string;
  size: number;
  /** Set on a knob that opens something beside it — the settings sheet. */
  expanded?: boolean;
  testID?: string;
  children: ReactNode;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityLabel={a11yLabel}
      {...a11yState({ role: "button", expanded })}
      style={({ pressed }) => [
        railStyles.knob,
        { width: size, height: size, borderRadius: size / 2 },
        pressed && railStyles.knobPressed,
      ]}
    >
      {children}
    </Pressable>
  );
}

/** Over the felt and the seats, under the banners and the overlays. */
const RAIL_Z = Layer.rail;

const railStyles = StyleSheet.create({
  // No horizontal edge here: `side` sets the one it is against, and a `left: 0`
  // left standing would pin the rail to both edges at once.
  rail: {
    position: "absolute",
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "space-between",
    zIndex: RAIL_Z,
    pointerEvents: "box-none",
  },
  knob: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Scrim.heavy,
    borderWidth: 1,
    borderColor: Colors.goldBorder,
  },
  knobPressed: { borderColor: Colors.goldStrong, backgroundColor: Colors.goldMuted },
});

// ─── Portrait overlay ─────────────────────────────────────────────────────────

export const portraitOverlayStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.overlayOpaque,
    alignItems: "center",
    justifyContent: "center",
    zIndex: Layer.held,
  },
  card: {
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing.xxl,
  },
  title: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.xl,
    color: Colors.text,
    letterSpacing: 1,
    textAlign: "center",
  },
  sub: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
});

// ─── Shared table styles ──────────────────────────────────────────────────────

export const sharedTableStyles = StyleSheet.create({
  tableOverlay: {
    position: "absolute",
    overflow: "visible",
  },
  tableContent: { flex: 1, flexDirection: "column" },
  // No fixed height: the top seat is the tallest thing on the table after the
  // hand, and a band guessed for it either clips the fan or spends felt the
  // field needed. What is left over is the mid band's, by construction.
  topSection: {
    alignItems: "center",
    justifyContent: "flex-start",
  },
  midSection: { flex: 1, flexDirection: "row", alignItems: "center" },
  // A side seat's fan is wider than SIDE_SECTION_W and is meant to be: it
  // leans in over the felt, the way a real player's hand does. Anchoring each
  // section to the table's outer edge is what keeps that overflow pointing
  // inward — centred, half of it lands off the side of the screen and takes
  // the avatar with it.
  // `alignSelf`, not `justifyContent`: the mid band is a row, so up-and-down is
  // its cross axis and only `alignSelf` moves a seat along it.
  sideSection: {
    width: SIDE_SECTION_W,
    alignSelf: "flex-start",
    paddingHorizontal: Spacing.sm,
  },
  sideSectionLeft: { alignItems: "flex-start" },
  sideSectionRight: { alignItems: "flex-end" },
  // Above both side seats: a combination thrown from a side seat crosses that
  // seat's own column on its way in, and the flight is drawn in here so that it
  // lands on the pile's centre rather than the screen's.
  centerSection: { flex: 1, alignItems: "center", justifyContent: "center", zIndex: Layer.table },
  // Bottom-aligned, not centred: the row's headroom is there for a selected
  // card's lift, which is above it. Centred, half that headroom sits *under*
  // the row and lifts the hand off the safe line, so the crop the cards are
  // laid out against is a third shallower than the one they were solved for —
  // and the buttons stop sitting on the line the prototype puts them on.
  handSection: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
  },
});

// ─── useHandLift ──────────────────────────────────────────────────────────────

/** How far the hand rises when the turn comes to the viewer, at scale 1. */
const HAND_LIFT = 4;
const HAND_LIFT_MS = 500;

/**
 * The hand rises off the bottom edge on the viewer's own turn — the fourth of
 * the table's signals about whose turn it is, after the lamp, the seat's ring
 * and the other seats dimming.
 *
 * A lift, not a wash: a lit band behind the hand is a gold hairline drawn the
 * full width of the table, which reads as chrome across the felt rather than
 * as the hand coming up. `translateY` alone, so the browser composites it.
 */
export function useHandLift(active: boolean, scale: number) {
  const lift = useSharedValue(0);
  // A CSS transition does not fire on the value an element mounts with, and
  // neither does this: a table rejoined mid-turn should open with the hand
  // already up, not raise it over half a second nobody asked for.
  const mounted = useRef(false);
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    // Anchored at the lifted state, not the settled one: the hand's designed
    // position — cards cropped by the bottom edge, buttons on the safe line —
    // is the one it holds while the player is using it. Lifting *from* that
    // position instead would spend the crop it is measured by.
    const resting = active ? 0 : HAND_LIFT * scale;
    if (!mounted.current || reduceMotion) {
      mounted.current = true;
      cancelAnimation(lift);
      lift.value = resting;
      return;
    }
    lift.value = withTiming(resting, {
      duration: HAND_LIFT_MS,
      easing: Easing.bezier(0.2, 0.8, 0.3, 1),
    });
    return () => cancelAnimation(lift);
  }, [active, scale, reduceMotion, lift]);

  return useAnimatedStyle(() => ({ transform: [{ translateY: lift.value }] }));
}

/**
 * The pre-first-play banner naming who opens and with what card. A component
 * of its own rather than inline JSX: `card` is only read here, so `rank` and
 * `suit` derive once instead of once per interpolation.
 */
export function StartCardBanner({
  card,
  starterIsViewer,
  starterName,
}: {
  card: Card;
  starterIsViewer: boolean;
  starterName: string;
}) {
  const { t } = useTranslation();
  const rank = getCardDisplayRank(card.rank);
  const suit = getSuitSymbol(card.suit);
  return (
    <View style={startCardStyles.banner}>
      <TableText style={startCardStyles.glyph}>{suit}</TableText>
      <TableText style={startCardStyles.text}>
        {starterIsViewer
          ? t("gameTable.startCardBannerSelf", { rank, suit })
          : t("gameTable.startCardBannerOther", { name: starterName, rank, suit })}
      </TableText>
    </View>
  );
}

const startCardStyles = StyleSheet.create({
  banner: {
    alignItems: "center", gap: Spacing.slim,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.snug, borderRadius: Radius.md,
    backgroundColor: Scrim.medium,
    borderWidth: 1, borderColor: Colors.goldSoft,
  },
  glyph: { fontSize: FontSize.xxl, color: Colors.text },
  text: {
    fontFamily: "Rajdhani_600SemiBold", fontSize: FontSize.sm,
    color: Colors.text, textAlign: "center", letterSpacing: 0.5,
  },
});
