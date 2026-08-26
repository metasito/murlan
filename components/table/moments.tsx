// The bomb's burst (flare + two waves + a ring of sparks) and the flush's
// sweep — one-shot celebrations fired by components/useTableFeedback.ts's
// `boomTrigger`/`flushTrigger` counters. "A number changed, play again" is
// the same pattern PlayedPile's own `bounceTrigger` already uses: the trigger
// only says an event happened, and each piece here decides for itself,
// against `usePrefersReducedMotion`, whether to actually animate.
//
// Every duration, delay and value below is the prototype's own `kick` /
// `flare` / `wave` / `spark` / `sweep` keyframes (issue #200), `* scale`.
// CSS interpolates a `transform` list either function-by-function or by full
// matrix decomposition depending on how the keyframes are written; neither
// is worth reproducing bit-for-bit here, so a channel a keyframe leaves
// unspecified between two that do set it is bridged with one tween across
// that whole span rather than replaying every percentage break.

import { useEffect } from "react";
import { View, StyleSheet, Platform, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withSequence,
  withDelay,
  cancelAnimation,
  Easing,
} from "react-native-reanimated";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import { stop } from "./felt";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { sparkOffset, SPARK_COUNT } from "@/components/gameTableModel";
import { makeShadow } from "@/lib/theme";

// The prototype's own literal colours for this one effect — a lamp exploding
// at the pile is a brighter, whiter flash than the felt's own ambient
// Lantern tokens, which are tuned for a light source rather than an event,
// and CLAUDE.md's invariant against a token used outside the role it was
// named for rules those out here.
const FLARE_CORE = "rgba(255,250,232,.98)";
const FLARE_MID = "rgba(255,201,102,.5)";
const FLARE_EDGE = "rgba(255,201,102,0)";
const WAVE_STROKE = "rgba(255,236,180,.9)";
const SPARK_FILL = "#FFE9B0";
const SPARK_GLOW = "#FFD070";
const SWEEP_BAND = "rgba(255,240,200,.42)";
const SWEEP_TRANSPARENT = "rgba(255,240,200,0)";

// `mix-blend-mode` has no native equivalent; RN Web passes it straight
// through as a style prop, and native ignores an unrecognised one.
const SCREEN_BLEND =
  Platform.OS === "web" ? ({ mixBlendMode: "screen" } as unknown as ViewStyle) : null;

// ─── Flare ──────────────────────────────────────────────────────────────────

const FLARE_ID = "bombFlare";
const FLARE_SIZE = 150;
const FLARE_MS = 1500;
const FLARE_EASING = Easing.bezier(0.12, 0.72, 0.28, 1);
const FLARE_Z = 10;

function Flare({ trigger, scale }: { trigger: number; scale: number }) {
  const reduceMotion = usePrefersReducedMotion();
  const opacity = useSharedValue(0);
  const scaleV = useSharedValue(0.15);

  useEffect(() => {
    if (!trigger || reduceMotion) return;
    opacity.value = 0;
    scaleV.value = 0.15;
    const e = FLARE_EASING;
    opacity.value = withSequence(
      withTiming(1, { duration: FLARE_MS * 0.06, easing: e }),
      withTiming(1, { duration: FLARE_MS * 0.06, easing: e }),
      withTiming(0, { duration: FLARE_MS * 0.88, easing: e })
    );
    scaleV.value = withSequence(
      withTiming(0.9, { duration: FLARE_MS * 0.06, easing: e }),
      withTiming(1.05, { duration: FLARE_MS * 0.06, easing: e }),
      withTiming(7, { duration: FLARE_MS * 0.88, easing: e })
    );
  }, [trigger, reduceMotion, opacity, scaleV]);

  useEffect(
    () => () => {
      cancelAnimation(opacity);
      cancelAnimation(scaleV);
    },
    [opacity, scaleV]
  );

  const aStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scaleV.value }],
  }));

  const size = FLARE_SIZE * scale;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        momentStyles.centered,
        { width: size, height: size, left: -size / 2, top: -size / 2, zIndex: FLARE_Z },
        SCREEN_BLEND,
        aStyle,
      ]}
    >
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <RadialGradient id={FLARE_ID}>
            <Stop offset={0} {...stop(FLARE_CORE)} />
            <Stop offset={0.4} {...stop(FLARE_MID)} />
            <Stop offset={0.72} {...stop(FLARE_EDGE)} />
          </RadialGradient>
        </Defs>
        <Rect width={100} height={100} fill={`url(#${FLARE_ID})`} />
      </Svg>
    </Animated.View>
  );
}

// ─── Wave ───────────────────────────────────────────────────────────────────

const WAVE_SIZE = 120;
const WAVE_BORDER = 2;
const WAVE_EASING = Easing.bezier(0.1, 0.7, 0.25, 1);
const WAVE_Z = 9;
/** The two rings' own delay and duration — the second trails the first. */
const WAVE_RINGS = [
  { delay: 80, duration: 1250 },
  { delay: 260, duration: 1350 },
] as const;

function Wave({
  trigger,
  scale,
  delayMs,
  durationMs,
}: {
  trigger: number;
  scale: number;
  delayMs: number;
  durationMs: number;
}) {
  const reduceMotion = usePrefersReducedMotion();
  const opacity = useSharedValue(0);
  const scaleV = useSharedValue(0.15);

  useEffect(() => {
    if (!trigger || reduceMotion) return;
    opacity.value = 0;
    scaleV.value = 0.15;
    const e = WAVE_EASING;
    opacity.value = withDelay(
      delayMs,
      withSequence(
        withTiming(0.95, { duration: durationMs * 0.08, easing: e }),
        withTiming(0, { duration: durationMs * 0.92, easing: e })
      )
    );
    scaleV.value = withDelay(delayMs, withTiming(6.5, { duration: durationMs, easing: e }));
  }, [trigger, reduceMotion, delayMs, durationMs, opacity, scaleV]);

  useEffect(
    () => () => {
      cancelAnimation(opacity);
      cancelAnimation(scaleV);
    },
    [opacity, scaleV]
  );

  const aStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scaleV.value }],
  }));

  const size = WAVE_SIZE * scale;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        momentStyles.centered,
        {
          width: size,
          height: size,
          left: -size / 2,
          top: -size / 2,
          borderRadius: size / 2,
          borderWidth: WAVE_BORDER * scale,
          borderColor: WAVE_STROKE,
          zIndex: WAVE_Z,
        },
        aStyle,
      ]}
    />
  );
}

// ─── Spark ──────────────────────────────────────────────────────────────────

const SPARK_SIZE = 3;
const SPARK_MS = 1150;
const SPARK_EASING = Easing.bezier(0.15, 0.75, 0.3, 1);
const SPARK_Z = 11;
const SPARK_SCALE_FROM = 0.4;
const SPARK_SCALE_TO = 0.2;

function Spark({ index, trigger, scale }: { index: number; trigger: number; scale: number }) {
  const reduceMotion = usePrefersReducedMotion();
  const opacity = useSharedValue(0);
  // 0 at the spark's own origin, 1 at its landing offset — drives translate
  // and scale together so both share the one tween.
  const progress = useSharedValue(0);
  const { dx, dy, delay } = sparkOffset(index, scale);

  useEffect(() => {
    if (!trigger || reduceMotion) return;
    opacity.value = 0;
    progress.value = 0;
    const e = SPARK_EASING;
    opacity.value = withDelay(
      delay,
      withSequence(
        withTiming(1, { duration: SPARK_MS * 0.1, easing: e }),
        withTiming(0, { duration: SPARK_MS * 0.9, easing: e })
      )
    );
    progress.value = withDelay(delay, withTiming(1, { duration: SPARK_MS, easing: e }));
  }, [trigger, reduceMotion, delay, opacity, progress]);

  useEffect(
    () => () => {
      cancelAnimation(opacity);
      cancelAnimation(progress);
    },
    [opacity, progress]
  );

  const aStyle = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      opacity: opacity.value,
      transform: [
        { translateX: dx * p },
        { translateY: dy * p },
        { scale: SPARK_SCALE_FROM + (SPARK_SCALE_TO - SPARK_SCALE_FROM) * p },
      ],
    };
  });

  const size = SPARK_SIZE * scale;
  // Static — a shadow outside `useAnimatedStyle` never touches the
  // per-frame animated path tests/animatedStyle.test.ts checks.
  const glow = makeShadow(SPARK_GLOW, 0, 0, 1, 7 * scale, 4);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        momentStyles.centered,
        {
          width: size,
          height: size,
          left: -size / 2,
          top: -size / 2,
          borderRadius: size / 2,
          backgroundColor: SPARK_FILL,
          zIndex: SPARK_Z,
        },
        glow,
        aStyle,
      ]}
    />
  );
}

// ─── BombBurst ──────────────────────────────────────────────────────────────

const SPARK_INDICES = Array.from({ length: SPARK_COUNT }, (_, i) => i);
// Over the pile it rings, under the flight still settling onto it
// (pileStyles.flyingContainer, zIndex 60). Stated, never left to sibling
// order — CLAUDE.md's invariant, and the iOS renderer is why.
const BURST_Z = 50;

/**
 * The bomb's four layers, centred on the impact point — the same point
 * `PlayedPile` draws the pile at. Rendered as a sibling of it inside the
 * table's own centre section.
 */
export function BombBurst({ trigger, scale }: { trigger: number; scale: number }) {
  return (
    <View pointerEvents="none" style={[momentStyles.overlay, { zIndex: BURST_Z }]}>
      <View style={momentStyles.anchor}>
        {WAVE_RINGS.map((ring, i) => (
          <Wave key={i} trigger={trigger} scale={scale} delayMs={ring.delay} durationMs={ring.duration} />
        ))}
        <Flare trigger={trigger} scale={scale} />
        {SPARK_INDICES.map((i) => (
          <Spark key={i} index={i} trigger={trigger} scale={scale} />
        ))}
      </View>
    </View>
  );
}

// ─── Sweep ──────────────────────────────────────────────────────────────────

const SWEEP_MS = 1500;
const SWEEP_EASING = Easing.bezier(0.4, 0, 0.25, 1);
// The band overflows -60%/-60% and -20%/-20% of the table box it covers, so
// it is already wider and taller than the table before it moves at all.
const SWEEP_W_FACTOR = 2.2;
const SWEEP_H_FACTOR = 1.4;
/** Its own travel: -60% to 60% of *its own* (oversized) width. */
const SWEEP_TRAVEL_FACTOR = 0.6;
const SWEEP_Z = 65;

/** A diagonal pass of light across the whole table — the flush's own sweep. */
export function Sweep({ trigger, width, height }: { trigger: number; width: number; height: number }) {
  const reduceMotion = usePrefersReducedMotion();
  const opacity = useSharedValue(0);
  // -1 to 1 across the band's own travel, which is applied at render: a
  // window resize changes how far that is, and must not restart the pass.
  const x = useSharedValue(0);
  const bandW = width * SWEEP_W_FACTOR;
  const bandH = height * SWEEP_H_FACTOR;
  const travel = bandW * SWEEP_TRAVEL_FACTOR;

  useEffect(() => {
    if (!trigger || reduceMotion) return;
    opacity.value = 0;
    x.value = -1;
    const e = SWEEP_EASING;
    opacity.value = withSequence(
      withTiming(1, { duration: SWEEP_MS * 0.12, easing: e }),
      withTiming(1, { duration: SWEEP_MS * 0.76, easing: e }),
      withTiming(0, { duration: SWEEP_MS * 0.12, easing: e })
    );
    x.value = withTiming(1, { duration: SWEEP_MS, easing: e });
  }, [trigger, reduceMotion, opacity, x]);

  useEffect(
    () => () => {
      cancelAnimation(opacity);
      cancelAnimation(x);
    },
    [opacity, x]
  );

  const aStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: x.value * travel }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          left: -(bandW - width) / 2,
          top: -(bandH - height) / 2,
          width: bandW,
          height: bandH,
          zIndex: SWEEP_Z,
        },
        SCREEN_BLEND,
        aStyle,
      ]}
    >
      <LinearGradient
        colors={[SWEEP_TRANSPARENT, SWEEP_BAND, SWEEP_TRANSPARENT]}
        locations={[0.42, 0.5, 0.58]}
        start={{ x: 0.05, y: 0.35 }}
        end={{ x: 0.95, y: 0.65 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const momentStyles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  // A zero-size point at the impact centre — Flare/Wave/Spark each centre on
  // it with their own negative half-size offset, the same anchor felt.tsx's
  // lamp hangs its own radials off.
  anchor: { position: "absolute", width: 0, height: 0 },
  centered: { position: "absolute" },
});
