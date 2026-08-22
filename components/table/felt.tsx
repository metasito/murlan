// The felt as a light source.
//
// Not a gradient over cloth: one lantern over a dark room, with everything
// else as material catching it. A warm core, a falloff through the felt the
// player chose, then real darkness — and a vignette over all of it as its own
// layer, so the pool can move without the vignette moving with it.
//
// The pool tracks whose turn it is, which is the first of the four signals the
// table gives about that (the others are the active seat's ring, the other
// seats dimming, and the action buttons going dark). It moves by `transform`
// alone: the gradient is drawn once, oversized, and slid under the felt's own
// clipping box.

import { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
  cancelAnimation,
} from "react-native-reanimated";
import Svg, { Defs, Line, Pattern, RadialGradient, Rect, Stop } from "react-native-svg";
import { Colors, Lantern } from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import type { FeltStops } from "@/lib/cosmetics";

// Radii as a fraction of the felt box, straight from the pool's own shape: a
// warm core at 44%, a falloff to 76%, darkness past it. The pool is drawn into
// a box twice the felt's size so it still covers the felt from any light
// position, which halves every fraction below.
const FIELD_RX = 0.76 / 2;
const FIELD_RY = 1.0 / 2;
const CORE_RX = 0.44 / 2;
const CORE_RY = 0.6 / 2;
const BLOOM_RX = 0.34 / 2;
const BLOOM_RY = 0.46 / 2;
/** The vignette is drawn over the felt itself, so its fractions are not halved. */
const VIGNETTE_RX = 1.28 / 2;
const VIGNETTE_RY = 1.04 / 2;

/**
 * An elliptical radial, as `gradientTransform` rather than as `rx`/`ry`.
 *
 * SVG has no `rx`/`ry` on `radialGradient`: react-native-svg accepts them and
 * passes them straight through, and every browser ignores them and falls back
 * to `r="50%"` — silently, and only on web.
 *
 * `r="50%"` in objectBoundingBox units is already the ellipse inscribed in the
 * box; scaling about the centre by each radius over that 50% gives the shape
 * the numbers above describe, on web and native alike.
 */
function ellipse(rx: number, ry: number): string {
  const sx = rx / 0.5;
  const sy = ry / 0.5;
  return `translate(0.5, 0.5) scale(${sx}, ${sy}) translate(-0.5, -0.5)`;
}

/** Where the felt's own five stops sit along the falloff, before the dark. */
const FIELD_OFFSETS = [0, 0.14, 0.3, 0.46, 0.62] as const;
/**
 * Past the felt's own five stops the cloth is still cloth, just barely lit —
 * two more stops carrying its last colour down into the room. Handing straight
 * from the fifth stop to `Colors.bg` crashes the falloff in a fifth of its
 * length and draws the lit middle as a column rather than a pool.
 */
const TAIL_OFFSETS = [0.78, 0.92] as const;
/** How far each tail stop has already become the room. */
const TAIL_MIX = [0.68, 0.93] as const;
/** …and where it is the room entirely. */
const DARK_OFFSET = 1;

/** `a` blended `t` of the way to `b`, both opaque hex. */
function mix(a: string, b: string, t: number): string {
  const channels = [1, 3, 5].map((i) => {
    const from = parseInt(a.slice(i, i + 2), 16);
    const to = parseInt(b.slice(i, i + 2), 16);
    return Math.round(from + (to - from) * t)
      .toString(16)
      .padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

// One table renders at a time, so these need only be unique within this file.
const FIELD_ID = "feltField";
const CORE_ID = "feltCore";
const BLOOM_ID = "feltBloom";
const VIGNETTE_ID = "feltVignette";
const WEAVE_LIGHT_ID = "feltWeaveLight";
const WEAVE_DARK_ID = "feltWeaveDark";

/** The cloth's weave: a 1px thread every 3px, crossing at 45 degrees. */
const WEAVE_PERIOD = 3;
const WEAVE_THREAD = 1;

/** How long the lamp takes to swing to the seat that just came on move. */
const LAMP_MS = 800;

export function FeltPool({
  width,
  height,
  stops,
  lightX,
  lightY,
}: {
  /** The felt box this pool fills. */
  width: number;
  height: number;
  /** The felt the player chose, light centre to dark rim. */
  stops: FeltStops;
  /** The lamp's position over that box, as a fraction of each side. */
  lightX: number;
  lightY: number;
}) {
  const reduceMotion = usePrefersReducedMotion();
  const x = useSharedValue(lightX * width);
  const y = useSharedValue(lightY * height);

  useEffect(() => {
    const duration = reduceMotion ? 0 : LAMP_MS;
    const easing = Easing.bezier(0.34, 1.36, 0.5, 1);
    x.value = withTiming(lightX * width, { duration, easing });
    y.value = withTiming(lightY * height, { duration, easing });
  }, [lightX, lightY, width, height, reduceMotion, x, y]);

  useEffect(
    () => () => {
      cancelAnimation(x);
      cancelAnimation(y);
    },
    [x, y]
  );

  const poolStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }],
  }));

  const poolW = width * 2;
  const poolH = height * 2;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Past the falloff there is no felt, only the room. */}
      <View style={[StyleSheet.absoluteFill, feltStyles.room]} />

      <Animated.View
        style={[
          { position: "absolute", left: -width, top: -height, width: poolW, height: poolH },
          poolStyle,
        ]}
      >
        <Svg width={poolW} height={poolH}>
          <Defs>
            <RadialGradient
              id={FIELD_ID}
              cx="50%"
              cy="50%"
              r="50%"
              gradientTransform={ellipse(FIELD_RX, FIELD_RY)}
            >
              <Stop offset={FIELD_OFFSETS[0]} stopColor={stops[0]} />
              <Stop offset={FIELD_OFFSETS[1]} stopColor={stops[1]} />
              <Stop offset={FIELD_OFFSETS[2]} stopColor={stops[2]} />
              <Stop offset={FIELD_OFFSETS[3]} stopColor={stops[3]} />
              <Stop offset={FIELD_OFFSETS[4]} stopColor={stops[4]} />
              <Stop offset={TAIL_OFFSETS[0]} stopColor={mix(stops[4], Colors.bg, TAIL_MIX[0])} />
              <Stop offset={TAIL_OFFSETS[1]} stopColor={mix(stops[4], Colors.bg, TAIL_MIX[1])} />
              <Stop offset={DARK_OFFSET} stopColor={Colors.bg} />
            </RadialGradient>
            <RadialGradient
              id={CORE_ID}
              cx="50%"
              cy="50%"
              r="50%"
              gradientTransform={ellipse(CORE_RX, CORE_RY)}
            >
              <Stop offset={0} stopColor={Lantern.core} />
              <Stop offset={0.46} stopColor={Lantern.coreMid} />
              <Stop offset={0.78} stopColor={Lantern.clear} />
            </RadialGradient>
            <RadialGradient
              id={BLOOM_ID}
              cx="50%"
              cy="50%"
              r="50%"
              gradientTransform={ellipse(BLOOM_RX, BLOOM_RY)}
            >
              <Stop offset={0} stopColor={Lantern.bloom} />
              <Stop offset={0.76} stopColor={Lantern.clear} />
            </RadialGradient>
          </Defs>
          <Rect width={poolW} height={poolH} fill={`url(#${FIELD_ID})`} />
          <Rect width={poolW} height={poolH} fill={`url(#${CORE_ID})`} />
          <Rect width={poolW} height={poolH} fill={`url(#${BLOOM_ID})`} />
        </Svg>
      </Animated.View>

      {/* The cloth itself. It does not move with the lamp — a weave that
          travelled with the light would read as a moving surface. */}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <Pattern
            id={WEAVE_LIGHT_ID}
            width={WEAVE_PERIOD}
            height={WEAVE_PERIOD}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <Line
              x1={0}
              y1={0}
              x2={0}
              y2={WEAVE_PERIOD}
              stroke={Lantern.weaveLight}
              strokeWidth={WEAVE_THREAD}
            />
          </Pattern>
          <Pattern
            id={WEAVE_DARK_ID}
            width={WEAVE_PERIOD}
            height={WEAVE_PERIOD}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(-45)"
          >
            <Line
              x1={0}
              y1={0}
              x2={0}
              y2={WEAVE_PERIOD}
              stroke={Lantern.weaveDark}
              strokeWidth={WEAVE_THREAD}
            />
          </Pattern>
        </Defs>
        <Rect width={width} height={height} fill={`url(#${WEAVE_LIGHT_ID})`} />
        <Rect width={width} height={height} fill={`url(#${WEAVE_DARK_ID})`} />
      </Svg>

      {/* Its own layer, and radial: a vignette assembled from straight-edged
          pieces carries ink along the edges facing the middle of the table and
          draws them as lines across the felt. */}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient
            id={VIGNETTE_ID}
            cx="50%"
            cy="50%"
            r="50%"
            gradientTransform={ellipse(VIGNETTE_RX, VIGNETTE_RY)}
          >
            <Stop offset={0.4} stopColor={Lantern.vignetteClear} />
            <Stop offset={1} stopColor={Lantern.vignette} />
          </RadialGradient>
        </Defs>
        <Rect width={width} height={height} fill={`url(#${VIGNETTE_ID})`} />
      </Svg>
    </View>
  );
}

const feltStyles = StyleSheet.create({
  room: { backgroundColor: Colors.bg },
});
