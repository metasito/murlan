// The bomb's burst (flare + two waves + a ring of sparks), the manche's own
// lamp lift, and the flush's sweep — one-shot celebrations fired by
// components/useTableFeedback.ts's `boomTrigger`/`lampLiftTrigger`/
// `flushTrigger` counters. "A number changed, play again" is the same
// pattern PlayedPile's own `bounceTrigger` already uses: the trigger only
// says an event happened, and each piece here decides for itself, against
// `usePrefersReducedMotion`, whether to actually animate.
//
// Every duration, delay and value below is the prototype's own `kick` /
// `flare` / `wave` / `spark` / `sweep` keyframes (issue #200), `* scale` —
// `LampLift` is the one exception, #765's own addition once the graduated
// escalation (#101) gave the manche rung a reaction of its own.
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
import { sparkOffset, SPARK_COUNT, type FlareKind } from "@/components/gameTableModel";
import { Layer, makeShadow, Motion } from "@/lib/theme";

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
// The lift's own glow (#765) — softer than the flare's near-white core: the
// manche rung hands over to its own banner rather than surprising the table,
// so it reads as the lamp itself brightening, not as a second flash. The
// felt's own `Lantern` tokens (lib/tokens.ts) are tuned as a continuous
// ambient stop at a few points of alpha — reused here at that same low
// alpha, this would land as CLAUDE.md's silently-almost-nothing failure, the
// same trap the flare's own literals above are already documented against.
const LIFT_CORE = "rgba(255,242,208,.6)";
const LIFT_MID = "rgba(255,236,190,.22)";
const LIFT_EDGE = "rgba(255,236,190,0)";

// `mix-blend-mode` has no native equivalent; RN Web passes it straight
// through as a style prop, and native ignores an unrecognised one.
const SCREEN_BLEND =
  Platform.OS === "web" ? ({ mixBlendMode: "screen" } as unknown as ViewStyle) : null;

// ─── Flare ──────────────────────────────────────────────────────────────────

const FLARE_ID = "bombFlare";
const FLARE_SIZE = 150;
/** The bomb's own window — brief, because the surprise is over the instant it lands. */
const FLARE_BRIEF_MS = 1500;
/**
 * The partita's own window — long enough to carry the closing beat rather
 * than read as a second bomb: `flareKindFor` (gameTableModel.ts) is what
 * decides which of the two a landing plays, never a branch in here.
 */
const FLARE_SETTLE_MS = FLARE_BRIEF_MS * 2;
const FLARE_EASING = Easing.bezier(0.12, 0.72, 0.28, 1);
const FLARE_Z = Layer.moment;

function flareDurationMs(kind: FlareKind): number {
  return kind === "settle" ? FLARE_SETTLE_MS : FLARE_BRIEF_MS;
}

function Flare({ trigger, scale, kind }: { trigger: number; scale: number; kind: FlareKind }) {
  const reduceMotion = usePrefersReducedMotion();
  const opacity = useSharedValue(0);
  const scaleV = useSharedValue(0.15);
  const flareMs = flareDurationMs(kind);

  useEffect(() => {
    if (!trigger || reduceMotion) return;
    opacity.value = 0;
    scaleV.value = 0.15;
    const e = FLARE_EASING;
    opacity.value = withSequence(
      withTiming(1, { duration: flareMs * 0.06, easing: e }),
      withTiming(1, { duration: flareMs * 0.06, easing: e }),
      withTiming(0, { duration: flareMs * 0.88, easing: e })
    );
    scaleV.value = withSequence(
      withTiming(0.9, { duration: flareMs * 0.06, easing: e }),
      withTiming(1.05, { duration: flareMs * 0.06, easing: e }),
      withTiming(7, { duration: flareMs * 0.88, easing: e })
    );
  }, [trigger, reduceMotion, flareMs, opacity, scaleV]);

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
const WAVE_Z = Layer.moment - 1;
/** The two rings. They run for the same length; the trail is entirely the delay. */
const WAVE_RINGS = [
  { delay: Motion.duration.flash, duration: Motion.duration.dwell },
  { delay: Motion.duration.travel, duration: Motion.duration.dwell },
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
const SPARK_Z = Layer.moment + 1;
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
// (pileStyles.flyingContainer, Layer.sheet). Stated, never left to sibling
// order — CLAUDE.md's invariant, and the iOS renderer is why.
const BURST_Z = Layer.band;

/**
 * The bomb's four layers, centred on the impact point — the same point
 * `PlayedPile` draws the pile at. Rendered as a sibling of it inside the
 * table's own centre section.
 *
 * `flareKind` names which of the two flaring tiers (#765) `trigger` is about
 * to re-fire for — "brief" for the bomb, "settle" for the partita — read off
 * `useTableFeedback`'s own `flareKind`, never guessed from `trigger` alone.
 */
export function BombBurst({
  trigger,
  scale,
  flareKind,
}: {
  trigger: number;
  scale: number;
  flareKind: FlareKind;
}) {
  return (
    <View pointerEvents="none" style={[momentStyles.overlay, { zIndex: BURST_Z }]}>
      <View style={momentStyles.anchor}>
        {WAVE_RINGS.map((ring, i) => (
          <Wave key={i} trigger={trigger} scale={scale} delayMs={ring.delay} durationMs={ring.duration} />
        ))}
        <Flare trigger={trigger} scale={scale} kind={flareKind} />
        {SPARK_INDICES.map((i) => (
          <Spark key={i} index={i} trigger={trigger} scale={scale} />
        ))}
      </View>
    </View>
  );
}

// ─── LampLift ───────────────────────────────────────────────────────────────
//
// The manche rung's own reaction (#765): a lift rather than a flare, since a
// manche closing is the expected ending and hands over to the round-winner
// banner rather than surprising the table the way a bomb or a partita does.
// A brightening-and-swelling pulse over the lamp's own position, never the
// lamp rig itself — `felt.tsx`'s own comments record the native-only cost of
// wrapping its `<Svg>` in a *repositioning* transform, and this needs none of
// that: it never moves, it only glows in place.

const LIFT_ID = "lampLift";
const LIFT_SIZE = 130;
const LIFT_MS = 900;
const LIFT_EASING = Easing.bezier(0.2, 0.6, 0.25, 1);
const LIFT_Z = Layer.felt;
const LIFT_SCALE_FROM = 0.7;
const LIFT_SCALE_TO = 1.35;

/**
 * `x`/`y` are the lamp's own centre in the felt box's own pixels —
 * `lightPosition` (gameTableModel.ts) resolved against the felt's width and
 * height, the same point `FeltPool` is already drawn at.
 */
export function LampLift({
  trigger,
  scale,
  x,
  y,
}: {
  trigger: number;
  scale: number;
  x: number;
  y: number;
}) {
  const reduceMotion = usePrefersReducedMotion();
  const opacity = useSharedValue(0);
  const scaleV = useSharedValue(LIFT_SCALE_FROM);

  useEffect(() => {
    if (!trigger || reduceMotion) return;
    opacity.value = 0;
    scaleV.value = LIFT_SCALE_FROM;
    const e = LIFT_EASING;
    opacity.value = withSequence(
      withTiming(0.85, { duration: LIFT_MS * 0.3, easing: e }),
      withTiming(0, { duration: LIFT_MS * 0.7, easing: e })
    );
    scaleV.value = withTiming(LIFT_SCALE_TO, { duration: LIFT_MS, easing: e });
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

  const size = LIFT_SIZE * scale;
  return (
    <Animated.View
      pointerEvents="none"
      testID="lamp-lift"
      style={[
        momentStyles.centered,
        { left: x - size / 2, top: y - size / 2, width: size, height: size, zIndex: LIFT_Z },
        aStyle,
      ]}
    >
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <RadialGradient id={LIFT_ID}>
            <Stop offset={0} {...stop(LIFT_CORE)} />
            <Stop offset={0.55} {...stop(LIFT_MID)} />
            <Stop offset={1} {...stop(LIFT_EDGE)} />
          </RadialGradient>
        </Defs>
        <Rect width={100} height={100} fill={`url(#${LIFT_ID})`} />
      </Svg>
    </Animated.View>
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
const SWEEP_Z = Layer.sheet + 1;

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
