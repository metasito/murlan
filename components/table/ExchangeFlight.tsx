import React, { useCallback, useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { CardView } from "@/components/CardView";
import { TableText } from "./TableText";
import type { Card } from "@/lib/gameEngine";
import { a11yHidden } from "@/lib/a11y";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { Colors, Motion, motionMs, Radius, Scrim, Spacing } from "@/lib/theme";
import { EXCHANGE_FLIGHT_MS, EXCHANGE_LEG_MS, MEET_HOLD_MS } from "@/lib/exchangeCeremony";
import type { ExchangeFlight as Trip } from "@/components/gameTableModel";

const TAG_FS = 11;

const OUT_EASING = Easing.bezier(0.3, 0.7, 0.4, 1);
const IN_EASING = Easing.bezier(0.4, 0, 0.5, 1);

/**
 * One card crossing the table from the seat that gave it to the seat that gets
 * it, pausing beside its counterpart at the middle.
 *
 * Positioned in the pile's own coordinates — the same deltas `flightOrigin`
 * hands the throw animation — so a card leaves exactly where that seat's cards
 * leave from and arrives exactly where that seat's cards arrive.
 */
export function ExchangeFlyingCard({
  card,
  trip,
  scale,
  testID,
  onDone,
}: {
  card: Card;
  trip: Trip;
  scale: number;
  /** The overlap check measures these two boxes — tests/e2e/exchangeNoOverlap.spec.ts. */
  testID: string;
  /** Called once when the card has landed. Optional — only one card needs it. */
  onDone?: () => void;
}) {
  const reduceMotion = usePrefersReducedMotion();
  const tx = useSharedValue(trip.from.dx);
  const ty = useSharedValue(trip.from.dy);
  const opacity = useSharedValue(0);

  // The caller passes a fresh closure every render; a ref keeps the flight from
  // restarting mid-trip when it does.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });
  const notifyDone = useCallback(() => onDoneRef.current?.(), []);

  useEffect(() => {
    if (reduceMotion) {
      // Under reduced motion the seat tags carry the whole message, so the card
      // rests at its destination rather than being thrown there.
      tx.value = trip.to.dx;
      ty.value = trip.to.dy;
      const settle = motionMs("reveal", reduceMotion);
      opacity.value = withTiming(1, { duration: settle });
      const id = setTimeout(() => onDoneRef.current?.(), settle);
      return () => clearTimeout(id);
    }

    opacity.value = withTiming(1, { duration: Motion.duration.flash });
    const out = { duration: EXCHANGE_LEG_MS, easing: OUT_EASING };
    const back = { duration: EXCHANGE_LEG_MS, easing: IN_EASING };
    tx.value = withSequence(
      withTiming(trip.meet.dx, out),
      withDelay(MEET_HOLD_MS, withTiming(trip.to.dx, back))
    );
    ty.value = withSequence(
      withTiming(trip.meet.dy, out),
      withDelay(MEET_HOLD_MS, withTiming(trip.to.dy, back))
    );
    // The landing is announced on a timer rather than an animation callback:
    // two values finish this trip, and a callback on either would fire while
    // the other was still running.
    const landed = setTimeout(notifyDone, EXCHANGE_FLIGHT_MS);

    return () => {
      clearTimeout(landed);
      cancelAnimation(tx);
      cancelAnimation(ty);
      cancelAnimation(opacity);
    };
  }, [trip, reduceMotion, tx, ty, opacity, notifyDone]);

  const anim = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: tx.value }, { translateY: ty.value }],
  }));

  return (
    <Animated.View
      testID={testID}
      pointerEvents="none"
      style={[styles.flier, anim]}
      {...a11yHidden()}
    >
      <View>
        <CardView card={card} scale={scale} noLift decorative light="flat" />
      </View>
    </Animated.View>
  );
}

/** How far clear of its own card a tag sits, beyond the card itself. */
const TAG_CLEARANCE = 30;

/**
 * What one seat got, beside that seat.
 *
 * The two players not trading are also watching this, and they cannot read a
 * flight they may have looked away from — so the words sit where the people
 * are, and each names its own side of the trade. It shares the flight's
 * geometry rather than measuring the seat again, and sits further along the
 * lane its own card took, so a tag is never on top of the card it describes
 * and the two tags are never on top of each other.
 */
export function ExchangeSeatTag({
  label,
  trip,
  visible,
}: {
  label: string;
  trip: Trip;
  visible: boolean;
}) {
  const reduceMotion = usePrefersReducedMotion();
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(visible ? 1 : 0, {
      duration: motionMs("reveal", reduceMotion),
    });
    return () => cancelAnimation(opacity);
  }, [visible, reduceMotion, opacity]);

  const anim = useAnimatedStyle(() => ({ opacity: opacity.value }));

  // Past the card rather than beside it: the lane is exactly the card's own
  // reach across the trip, so one more of it clears the card that landed here,
  // and the far lane is the other way round from this one.
  const laneLen = Math.hypot(trip.lane.dx, trip.lane.dy) || 1;
  const reach = laneLen + TAG_CLEARANCE;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.flier,
        {
          transform: [
            { translateX: trip.to.dx + (trip.lane.dx / laneLen) * reach },
            { translateY: trip.to.dy + (trip.lane.dy / laneLen) * reach },
          ],
        },
        anim,
      ]}
    >
      <TableText {...a11yHidden()} style={styles.tag}>
        {label}
      </TableText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flier: { position: "absolute" },
  tag: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: TAG_FS,
    color: Colors.gold,
    backgroundColor: Scrim.heavy,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.xs,
    paddingVertical: Spacing.xxs,
    overflow: "hidden",
  },
});
