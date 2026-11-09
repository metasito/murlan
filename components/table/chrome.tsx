import { useEffect, useRef, type ReactNode } from "react";
import { View, StyleSheet, Pressable, type AccessibilityProps, type ViewProps } from "react-native";
import {
  Easing,
  useAnimatedStyle,
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
import { useOwnedValue } from "@/lib/motion";
import { a11yState } from "@/lib/a11y";
import { handLiftY, HAND_ZONE_ALIGN, SIDE_SECTION_W } from "@/components/seatLayout";
import { RAIL_KNOB_ALIGN, type Rect } from "@/components/tableLayout";
import type { Channel } from "@/lib/harnessChannels";

/**
 * A sentence for the browser harness, on a channel lib/harnessChannels.ts registers. Not a
 * label: a container that cannot be `accessible` names no reader. The cast is for web-only `dataSet`.
 */
export const harnessState = <S extends Partial<Record<Channel, string>>>(
  state: S & Record<Exclude<keyof S, Channel>, never>,
) => ({ dataSet: state }) as ViewProps;

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
  height,
  menu,
  foot,
  top,
  bottom,
  veiled,
}: {
  width: number;
  height: number;
  /** `tableLayout`'s knob slots: `top` hangs from the menu's, `bottom` stands on the foot's. */
  menu: Rect;
  foot: Rect;
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
      style={[railStyles.rail, { width }]}
      {...veiled}
    >
      <View style={[railStyles.slot, { width, top: menu.y }]}>{top}</View>
      <View style={[railStyles.slot, { width, bottom: height - foot.y - foot.h }]}>{bottom}</View>
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
    zIndex: RAIL_Z,
    pointerEvents: "box-none",
  },
  slot: { position: "absolute", left: 0, alignItems: RAIL_KNOB_ALIGN },
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
  handSection: {
    flexDirection: "row",
    alignItems: HAND_ZONE_ALIGN,
    justifyContent: "center",
  },
});

// ─── useHandLift ──────────────────────────────────────────────────────────────

/**
 * The hand rises off the bottom edge on the viewer's own turn — one of the
 * table's signals about whose turn it is, beside the lamp over the hand and
 * the lit turn pill.
 *
 * A lift, not a wash: a lit band behind the hand is a gold hairline drawn the
 * full width of the table, which reads as chrome across the felt rather than
 * as the hand coming up. `translateY` alone, so the browser composites it.
 */
export function useHandLift(active: boolean, scale: number) {
  const lift = useOwnedValue(0);
  // A CSS transition does not fire on the value an element mounts with, and
  // neither does this: a table rejoined mid-turn should open with the hand
  // already up, not raise it over half a second nobody asked for.
  const mounted = useRef(false);
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    const resting = handLiftY(active, scale);
    if (!mounted.current || reduceMotion) {
      mounted.current = true;
      cancelAnimation(lift);
      lift.set(resting);
      return;
    }
    lift.set(withTiming(resting, { duration: Motion.handLift, easing: Easing.bezier(0.2, 0.8, 0.3, 1) }));
  }, [active, scale, reduceMotion, lift]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateY: lift.value }] }));
  return { style, lift };
}

/**
 * The HUD chips and the reactions trigger fade rather than vanish under focus
 * mode — kept mounted throughout, so a timer or an in-flight animation living
 * inside them (the turn countdown included) is never torn down and restarted
 * by a toggle that is about decluttering the felt, not about the turn itself.
 */
export function useFocusFade(focusMode: boolean) {
  const fade = useOwnedValue(1);
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    const target = focusMode ? 0 : 1;
    if (reduceMotion) {
      cancelAnimation(fade);
      fade.set(target);
      return;
    }
    fade.set(withTiming(target, { duration: Motion.duration.travel }));
  }, [focusMode, reduceMotion, fade]);

  return useAnimatedStyle(() => ({ opacity: fade.value }));
}
