import { useEffect, useState, type ReactNode } from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { AnimatedTableText, TableText } from "./TableText";
import {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withSequence,
  withRepeat,
  cancelAnimation,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { Colors, FontSize, Motion, Radius, Scrim, Shadow, Spacing, Type } from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useTranslation } from "@/lib/i18n";
import type { StartReason } from "@/lib/gameEngine";
import { getCardDisplayRank, getSuitSymbol } from "@/lib/gameEngine";
import { SIDE_SECTION_W } from "@/components/gameTableModel";

// ─── Table vignette ───────────────────────────────────────────────────────────

// Four edge washes plus four diagonal corner washes. The corners are the half
// that makes it read as a lit table rather than as four dark stripes: without
// them the corner is only as dark as one edge, so the darkest region of the
// felt ends up on the edge midpoints instead of the extremities.
export function TableVignette() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient
        colors={[Scrim.medium, "transparent"]}
        style={vignetteStyles.top}
        pointerEvents="none"
      />
      <LinearGradient
        colors={["transparent", Scrim.heavy]}
        style={vignetteStyles.bottom}
        pointerEvents="none"
      />
      <LinearGradient
        colors={[Scrim.medium, "transparent"]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={vignetteStyles.left}
        pointerEvents="none"
      />
      <LinearGradient
        colors={["transparent", Scrim.medium]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={vignetteStyles.right}
        pointerEvents="none"
      />
    </View>
  );
}

// Four bands, each spanning a full edge and reaching transparent inside the
// felt. A corner piece cannot: a diagonal gradient over a box only reaches
// transparent at the box's opposite corner, so it still carries ink along the
// two edges that face the middle of the table and draws them as hard lines
// across the felt. The corners are darkened by the bands overlapping instead.
const vignetteStyles = StyleSheet.create({
  top:    { position: "absolute", top: 0, left: 0, right: 0, height: "22%" },
  bottom: { position: "absolute", bottom: 0, left: 0, right: 0, height: "26%" },
  left:   { position: "absolute", top: 0, bottom: 0, left: 0, width: "16%" },
  right:  { position: "absolute", top: 0, bottom: 0, right: 0, width: "16%" },
});

// ─── StartReasonBanner ────────────────────────────────────────────────────────

export function StartReasonBanner({
  reason,
  players,
  topOffset,
}: {
  reason: StartReason;
  players: { name: string; type: string }[];
  topOffset: number;
}) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(timer);
  }, []);
  if (!visible) return null;

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
    <Pressable
      onPress={() => setVisible(false)}
      style={[startReasonStyles.anchor, { top: topOffset }]}
    >
      <View style={startReasonStyles.card}>
        <TableText style={startReasonStyles.main}>
          {mainText}
        </TableText>
        {subText ? (
          <TableText style={startReasonStyles.sub}>
            {subText}
          </TableText>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Over the felt and the flying cards, under the exchange and the overlays. */
const START_REASON_Z = 50;
const START_REASON_MAX_W = 420;

const startReasonStyles = StyleSheet.create({
  anchor: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: START_REASON_Z,
    pointerEvents: "box-none",
  },
  card: {
    backgroundColor: Colors.overlayStrong,
    borderColor: Colors.gold,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    alignItems: "center",
    maxWidth: START_REASON_MAX_W,
    gap: Spacing.xs,
  },
  main: {
    ...Type.subheading,
    color: Colors.gold,
    letterSpacing: 0.5,
    textAlign: "center",
  },
  sub: {
    ...Type.caption,
    color: Colors.textSecondary,
    textAlign: "center",
  },
});

// ─── Control rail ─────────────────────────────────────────────────────────────

/**
 * The column the device cutout occupies, turned into the table's control
 * column: `top` at the head, `bottom` at the foot, and the cutout in the gap
 * between them. Its width comes from `railWidth` (components/gameTableModel.ts),
 * which floors it well above a 44pt knob so a phone with no cutout lays out
 * exactly like one with a Dynamic Island.
 */
export function ControlRail({
  width,
  topPad,
  bottomPad,
  top,
  bottom,
}: {
  width: number;
  topPad: number;
  bottomPad: number;
  top?: ReactNode;
  bottom?: ReactNode;
}) {
  return (
    <View
      testID="control-rail"
      style={[railStyles.rail, { width, paddingTop: topPad, paddingBottom: bottomPad }]}
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
  children,
}: {
  onPress: () => void;
  a11yLabel: string;
  size: number;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
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
const RAIL_Z = 20;

const railStyles = StyleSheet.create({
  rail: {
    position: "absolute",
    left: 0,
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
    zIndex: 999,
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
  tableBg: {
    position: "absolute",
    borderRadius: Radius.lg,
    overflow: "hidden",
    borderWidth: 3.5,
    borderColor: Colors.goldStrong,
  },
  tableOverlay: {
    position: "absolute",
    overflow: "visible",
  },
  tableInnerBorder: {
    position: "absolute",
    top: 6,
    left: 6,
    right: 6,
    bottom: 6,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.goldSoft,
  },
  tableContent: { flex: 1, flexDirection: "column" },
  topSection: {
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 1,
    borderBottomColor: Colors.goldGhost,
  },
  midSection: { flex: 1, flexDirection: "row", alignItems: "center" },
  // A side seat's fan is wider than SIDE_SECTION_W and is meant to be: it
  // leans in over the felt, the way a real player's hand does. Anchoring each
  // section to the table's outer edge is what keeps that overflow pointing
  // inward — centred, half of it lands off the side of the screen and takes
  // the avatar with it.
  sideSection: {
    width: SIDE_SECTION_W,
    justifyContent: "center",
    paddingHorizontal: Spacing.sm,
  },
  sideSectionLeft: { alignItems: "flex-start" },
  sideSectionRight: { alignItems: "flex-end" },
  centerSection: { flex: 1, alignItems: "center", justifyContent: "center" },
  handSection: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  handSectionActive: {
    backgroundColor: Colors.goldGhost,
  },
  // The turn pulse, as a textless childless sibling behind the hand: the glow
  // and the hairline along the top edge are fixed, and useTurnPulse animates
  // only this view's opacity. The wash and the hairline are what the shadow is
  // cast from — a layer with transparent contents has nothing for iOS to blur
  // and gives Android's elevation no outline.
  handGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: Radius.md,
    borderTopWidth: 1,
    borderTopColor: Colors.goldStrong,
    backgroundColor: Colors.goldGhost,
    ...Shadow.goldSoft,
  },
});

// ─── useTurnPulse ─────────────────────────────────────────────────────────────

export function useTurnPulse(active: boolean) {
  const glowV = useSharedValue(0);
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (active && reduceMotion) {
      // Same affordance, no breathing: hold the glow at its midpoint.
      cancelAnimation(glowV);
      glowV.value = 0.6;
      return;
    }
    if (active) {
      glowV.value = 0.35;
      glowV.value = withRepeat(
        withSequence(
          withTiming(0.85, { duration: 900 }),
          withTiming(0.35, { duration: 900 })
        ),
        -1,
        false
      );
    } else {
      cancelAnimation(glowV);
      glowV.value = withTiming(0, { duration: Motion.duration.moderate });
    }
    return () => {
      cancelAnimation(glowV);
    };
  }, [active, reduceMotion, glowV]);

  // Opacity only. The glow and the gold hairline are static, on the childless
  // sibling the caller puts behind the hand (`sharedTableStyles.handGlow`):
  // a shadow or a border colour written per frame is paint the browser cannot
  // composite, and on web reanimated writes it from the main JS thread.
  return useAnimatedStyle(() => ({ opacity: glowV.value }));
}

// ─── GameBillboard ────────────────────────────────────────────────────────────

export function GameBillboard({
  roundLabel,
  currentComboLabel,
  currentTurnName,
  isLocalPlayerTurn,
}: {
  roundLabel: string;
  currentComboLabel: string | null;
  currentTurnName: string;
  isLocalPlayerTurn: boolean;
}) {
  const { t } = useTranslation();
  const dotOpacity = useSharedValue(0.3);
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (isLocalPlayerTurn && reduceMotion) {
      cancelAnimation(dotOpacity);
      dotOpacity.value = 1;
      return;
    }
    if (isLocalPlayerTurn) {
      dotOpacity.value = withRepeat(
        withSequence(
          withTiming(1.0, { duration: Motion.duration.slow }),
          withTiming(0.3, { duration: Motion.duration.slow })
        ),
        -1,
        false
      );
    } else {
      cancelAnimation(dotOpacity);
      dotOpacity.value = withTiming(0, { duration: Motion.duration.base });
    }
    return () => {
      cancelAnimation(dotOpacity);
    };
  }, [isLocalPlayerTurn, reduceMotion, dotOpacity]);

  const dotStyle = useAnimatedStyle(() => ({ opacity: dotOpacity.value }));

  return (
    <View style={billboardStyles.container}>
      <TableText style={billboardStyles.comboLabel} numberOfLines={1}>
        {currentComboLabel ?? t("gameShared.emptyTable")}
      </TableText>
      <View style={billboardStyles.bottomRow}>
        <TableText style={billboardStyles.roundLabel} numberOfLines={1}>{roundLabel}</TableText>
        {isLocalPlayerTurn && (
          <AnimatedTableText style={[billboardStyles.turnDot, dotStyle]}>●</AnimatedTableText>
        )}
        <TableText
          style={[
            billboardStyles.turnLabel,
            isLocalPlayerTurn && billboardStyles.turnLabelActive,
          ]}
          numberOfLines={1}
        >
          {isLocalPlayerTurn ? t("gameShared.yourTurn") : t("gameShared.turnOf", { name: currentTurnName })}
        </TableText>
      </View>
    </View>
  );
}

const billboardStyles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    paddingHorizontal: Spacing.xs,
    gap: Spacing.xxs,
  },
  comboLabel: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.sm,
    color: Colors.gold,
    letterSpacing: 0.5,
    textAlign: "center",
  },
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  roundLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.xxs,
    color: Colors.textMuted,
  },
  turnDot: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.xxs,
    color: Colors.gold,
  },
  turnLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.xxs,
    color: Colors.textSecondary,
  },
  turnLabelActive: {
    color: Colors.gold,
    fontFamily: "Rajdhani_600SemiBold",
  },
});
