import { useEffect, useRef, type ReactNode } from "react";
import { View, StyleSheet, Pressable, type AccessibilityProps, type ViewProps } from "react-native";
import {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  cancelAnimation,
} from "react-native-reanimated";
import {
  Colors,
  FontSize,
  Motion,
  Scrim,
  Spacing,
  Layer,
} from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { a11yState } from "@/lib/a11y";
import { SIDE_SECTION_W } from "@/components/seatLayout";

/**
 * A sentence for the browser harness, as `data-<key>` (`tests/e2e/helpers/selectors.ts`). Not a
 * label: a container that cannot be `accessible` names no reader. The cast is for web-only `dataSet`.
 */
export const harnessState = (state: Record<string, string>) => ({ dataSet: state }) as ViewProps;

// ─── Control rail ─────────────────────────────────────────────────────────────

/**
 * The table's control column, always against the left edge: `top` at the
 * head, `bottom` at the foot, and a cutout on that edge in the gap between
 * them. Its width comes from `railWidth` (components/tableFrame.ts),
 * which floors it well above a 44pt knob so a phone with no cutout lays out
 * exactly like one with a Dynamic Island.
 */
/** The rail stays reachable behind a layer that traps focus (lib/a11y.tsx). */
export const RAIL_TESTID = "control-rail";

export function ControlRail({
  width,
  topPad,
  bottomPad,
  top,
  bottom,
  veiled,
}: {
  width: number;
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
        { width, paddingTop: topPad, paddingBottom: bottomPad },
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
  rail: {
    position: "absolute",
    top: 0,
    left: 0,
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
    ...StyleSheet.absoluteFill,
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
  // Its height is `topBandHeight` (components/tableFrame.ts), passed in: sized for the drawn cap,
  // so the band below it, and the pile in it, stay put as the top seat's hand shrinks.
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
  // its cross axis and only `alignSelf` moves a seat along it. Inside, the seat
  // centres in a slot `sideSlotHeight` tall (components/tableFrame.ts), passed in.
  sideSection: {
    width: SIDE_SECTION_W,
    alignSelf: "flex-start",
    justifyContent: "center",
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
 * and its name lit gold.
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
 * The HUD chips and the reactions trigger fade rather than vanish under focus
 * mode — kept mounted throughout, so a timer or an in-flight animation living
 * inside them (the turn countdown included) is never torn down and restarted
 * by a toggle that is about decluttering the felt, not about the turn itself.
 */
export function useFocusFade(focusMode: boolean) {
  const fade = useSharedValue(1);
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    const target = focusMode ? 0 : 1;
    if (reduceMotion) {
      cancelAnimation(fade);
      fade.value = target;
      return;
    }
    fade.value = withTiming(target, { duration: Motion.duration.travel });
    return () => cancelAnimation(fade);
  }, [focusMode, reduceMotion, fade]);

  return useAnimatedStyle(() => ({ opacity: fade.value }));
}
