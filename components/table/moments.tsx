// The bomb's burst (flare + two waves) and flash — one-shot celebrations. The
// burst reacts to the landing signal on its contact frame. Each piece decides
// for itself, against `usePrefersReducedMotion`, whether to animate.
//
// Every duration, delay and value below is the prototype's own `kick` /
// `flare` / `wave` keyframes (issue #200), `* scale`.
// CSS interpolates a `transform` list either function-by-function or by full
// matrix decomposition depending on how the keyframes are written; neither
// is worth reproducing bit-for-bit here, so a channel a keyframe leaves
// unspecified between two that do set it is bridged with one tween across
// that whole span rather than replaying every percentage break.

import { Platform, View, StyleSheet, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withSequence,
  withDelay,
  Easing,
  ReduceMotion,
  type SharedValue,
} from "react-native-reanimated";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useOwnedValue } from "@/lib/motion";
import { pileBursts } from "@/components/impact";
import { BombFx, Layer, makeShadow, withAlpha, Motion, Scrim } from "@/lib/theme";
import { useLandingReaction } from "@/components/table/useLandingReaction";
import { useBombBeat } from "@/components/table/useBombBeat";
import type { LandingSignal } from "@/components/table/useFlightClock";

// The prototype's own literal colours for this one effect — a lamp exploding
// at the pile is a brighter, whiter flash than the lamp's own tokens, which
// are tuned for a light source rather than an event, and CLAUDE.md's invariant against a token used outside the role it was
// named for rules those out here.
//
// `Flare` does not animate an `<Svg>`. #209 recorded that
// react-native-svg's native path paints at
// its own laid-out bounds and does not move with a `transform` on an
// ancestor view — a bug this codebase has already paid for twice, and one no
// device access this session can re-verify a variant of. It animates a
// plain `Animated.View`'s own `opacity`/`transform` instead, the shape
// `Wave` already uses, with a static blurred `glow` (`makeShadow`)
// on web for the outer halo; native draws it as one more circle.
// Native composites a blended layer through an offscreen pass on every frame it moves, and the flare grows to
// seven times its size: it fades by opacity there instead, over the dark felt.
const NATIVE = Platform.OS !== "web";
const SCREEN_BLEND: ViewStyle | null = NATIVE ? null : { mixBlendMode: "screen" };
const FLARE_GLOW = "#FFC966";
const WAVE_STROKE = "rgba(255,236,180,.9)";

/**
 * A single flat fill reads as a coin, not a bloom of light — a second blind
 * critique on #765 caught exactly that on `Flare`'s own replacement shape.
 * `GradientLayers` fakes the falloff a radial gradient would have painted
 * with a handful of concentric, decreasingly-transparent plain circles,
 * largest and faintest first so each later (smaller, brighter) one composites
 * on top — cheap, and every one of them still only ever animates via the
 * parent `Animated.View`'s own `transform`/`opacity`, never its own.
 */
interface GradientLayer {
  /** This layer's own diameter, as a fraction of the parent's `size`. */
  diameterFactor: number;
  fill: string;
}

function GradientLayers({ size, layers }: { size: number; layers: readonly GradientLayer[] }) {
  return (
    <>
      {layers.map((layer, i) => {
        const d = size * layer.diameterFactor;
        return (
          <View
            key={i}
            style={{
              position: "absolute",
              width: d,
              height: d,
              left: (size - d) / 2,
              top: (size - d) / 2,
              borderRadius: d / 2,
              backgroundColor: layer.fill,
            }}
          />
        );
      })}
    </>
  );
}

/**
 * The bomb/match flare's own falloff — a hand-stepped approximation of the
 * three-stop SVG radial gradient this effect shipped with in #200 (core
 * `rgba(255,250,232,.98)` at the centre, through gold at 40% of the radius,
 * to transparent at 72%). Every diameter and alpha step is its own named
 * constant, #765's own acceptance criterion for a duration/opacity step.
 */
const FLARE_LAYER_OUTER_DIAMETER = 0.7;
const FLARE_LAYER_OUTER_ALPHA = 0.18;
const FLARE_LAYER_MID_DIAMETER = 0.42;
const FLARE_LAYER_MID_ALPHA = 0.42;
const FLARE_LAYER_MID_COLOR = "#FFDE9E";
const FLARE_LAYER_CORE_DIAMETER = 0.16;
const FLARE_LAYER_CORE_ALPHA = 0.92;
const FLARE_LAYER_CORE_COLOR = "#FFFAE8";

const FLARE_HALO_DIAMETER = 1;
const FLARE_HALO_ALPHA = 0.07;

// Web paints the halo as a blurred shadow; a shadow scaled 7x is rasterised again every frame on native, so
// there it is one more circle, drawn once and only ever scaled and faded with the rest.
const FLARE_LAYERS: readonly GradientLayer[] = [
  ...(NATIVE ? [{ diameterFactor: FLARE_HALO_DIAMETER, fill: withAlpha(FLARE_GLOW, FLARE_HALO_ALPHA) }] : []),
  { diameterFactor: FLARE_LAYER_OUTER_DIAMETER, fill: withAlpha(FLARE_GLOW, FLARE_LAYER_OUTER_ALPHA) },
  { diameterFactor: FLARE_LAYER_MID_DIAMETER, fill: withAlpha(FLARE_LAYER_MID_COLOR, FLARE_LAYER_MID_ALPHA) },
  { diameterFactor: FLARE_LAYER_CORE_DIAMETER, fill: withAlpha(FLARE_LAYER_CORE_COLOR, FLARE_LAYER_CORE_ALPHA) },
];


// ─── Flare ──────────────────────────────────────────────────────────────────

const FLARE_SIZE = 150;
/** Brief, because the surprise is over the instant it lands. */
const FLARE_MS = NATIVE ? Motion.nativeBurst.flare : 1500;
const FLARE_EASING = Easing.bezier(0.12, 0.72, 0.28, 1);
const FLARE_Z = Layer.moment;

/** Runs `fire` on the contact frame of a landing that bursts at the pile, unless reduced motion withholds the burst. */
function useBurst(landing: SharedValue<LandingSignal>, reduceMotion: boolean, fire: () => void): void {
  useLandingReaction(landing, (l) => {
    "worklet";
    if (pileBursts(l.tier) && !reduceMotion) fire();
  });
}

function Flare({ landing, scale }: { landing: SharedValue<LandingSignal>; scale: number }) {
  const opacity = useOwnedValue(0);
  const scaleV = useOwnedValue(0.15);

  useBurst(landing, usePrefersReducedMotion(), () => {
    "worklet";
    const e = FLARE_EASING;
    opacity.set(0);
    scaleV.set(0.15);
    opacity.set(
      withSequence(
        withTiming(1, { duration: FLARE_MS * 0.06, easing: e }),
        withTiming(1, { duration: FLARE_MS * 0.06, easing: e }),
        withTiming(0, { duration: FLARE_MS * 0.88, easing: e })
      )
    );
    scaleV.set(
      withSequence(
        withTiming(0.9, { duration: FLARE_MS * 0.06, easing: e }),
        withTiming(1.05, { duration: FLARE_MS * 0.06, easing: e }),
        withTiming(7, { duration: FLARE_MS * 0.88, easing: e })
      )
    );
  });

  const aStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scaleV.value }],
  }));

  const size = FLARE_SIZE * scale;
  // Static — a shadow outside `useAnimatedStyle` never touches the per-frame
  // animated path the `animate-compositor-props` guard in eslint.guards.cjs checks.
  const glow = NATIVE ? null : makeShadow(FLARE_GLOW, 0, 0, 1, size * 0.55, 10);
  return (
    <Animated.View
      pointerEvents="none"
      testID="bomb-flare"
      style={[
        momentStyles.centered,
        { width: size, height: size, left: -size / 2, top: -size / 2, zIndex: FLARE_Z },
        glow,
        SCREEN_BLEND,
        aStyle,
      ]}
    >
      <GradientLayers size={size} layers={FLARE_LAYERS} />
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
  index,
  landing,
  scale,
  delayMs,
  durationMs,
}: {
  index: number;
  landing: SharedValue<LandingSignal>;
  scale: number;
  delayMs: number;
  durationMs: number;
}) {
  const opacity = useOwnedValue(0);
  const scaleV = useOwnedValue(0.15);

  useBurst(landing, usePrefersReducedMotion(), () => {
    "worklet";
    const e = WAVE_EASING;
    opacity.set(0);
    scaleV.set(0.15);
    opacity.set(
      withDelay(
        delayMs,
        withSequence(
          withTiming(0.95, { duration: durationMs * 0.08, easing: e }),
          withTiming(0, { duration: durationMs * 0.92, easing: e })
        ),
        ReduceMotion.System
      )
    );
    scaleV.set(withDelay(delayMs, withTiming(6.5, { duration: durationMs, easing: e }), ReduceMotion.System));
  });

  const aStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scaleV.value }],
  }));

  const size = WAVE_SIZE * scale;
  return (
    <Animated.View
      pointerEvents="none"
      testID={`bomb-wave-${index}`}
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

// ─── BombBurst ──────────────────────────────────────────────────────────────

// Over the pile it rings, under the flight still settling onto it
// (pileStyles.flyingContainer, Layer.sheet). Stated, never left to sibling
// order — CLAUDE.md's invariant, and the iOS renderer is why.
const BURST_Z = Layer.band;

/**
 * The bomb's three layers, centred on the impact point — the same point
 * `PileLayer` draws the pile at. Rendered as a sibling of it inside the
 * table's own centre section. Each fires on the contact frame of a landing
 * that `pileBursts` (impact.ts) answers yes for.
 */
export function BombBurst({ landing, scale }: { landing: SharedValue<LandingSignal>; scale: number }) {
  return (
    <View pointerEvents="none" style={[momentStyles.overlay, { zIndex: BURST_Z }]}>
      <View style={momentStyles.anchor}>
        {WAVE_RINGS.map((ring, i) => (
          <Wave key={i} index={i} landing={landing} scale={scale} delayMs={ring.delay} durationMs={ring.duration} />
        ))}
        <Flare landing={landing} scale={scale} />
      </View>
    </View>
  );
}

// ─── Felt scrim ─────────────────────────────────────────────────────────────

/** `dim` is driven by `usePileFlight` (components/table/pile.tsx), which owns the throw's timing. */
export function FeltScrim({ dim }: { dim: SharedValue<number> }) {
  const aStyle = useAnimatedStyle(() => ({ opacity: dim.value }));
  return (
    <Animated.View
      testID="felt-scrim"
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: Scrim.solid, zIndex: Layer.feltScrim }, aStyle]}
    />
  );
}

// ─── Bomb flash ─────────────────────────────────────────────────────────────

/** The mockup's `flash(1, 280)`, once per bomb and, a photosensitivity cap, never twice within `BombFx.flashGapMs`. */
export function BombFlash({ landing }: { landing: SharedValue<LandingSignal> }) {
  const opacity = useOwnedValue(0);
  const lastAt = useSharedValue(-Infinity);
  useBombBeat(landing, usePrefersReducedMotion(), (l) => {
    "worklet";
    if (l.at - lastAt.value < BombFx.flashGapMs) return;
    lastAt.value = l.at;
    opacity.set(1);
    opacity.set(withTiming(0, { duration: BombFx.flashMs, easing: Easing.out(Easing.cubic) }));
  });
  const aStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      testID="bomb-flash"
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: BombFx.flash, zIndex: Layer.flash }, aStyle]}
    />
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
  // A zero-size point at the impact centre — Flare/Wave each centre on
  // it with their own negative half-size offset.
  anchor: { position: "absolute", width: 0, height: 0 },
  centered: { position: "absolute" },
});
