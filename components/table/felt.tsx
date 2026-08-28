// The felt as a light source.
//
// Not a gradient over cloth: one lantern over a dark room, with everything
// else as material catching it. A warm core, a falloff through the felt the
// player chose, then real darkness — and a vignette over all of it as its own
// layer, so the pool can move without the vignette moving with it.
//
// The pool tracks whose turn it is, which is the first of the four signals the
// table gives about that (the others are the active seat's ring, the other
// seats dimming, and the action buttons going dark). The gradient is drawn
// once, oversized, and slid under the felt's own clipping box.
//
// It swings by the anchor's own `left`/`top` on native, and by `transform` on
// web. `react-native-svg`'s native path paints each `<Svg>` at its own
// laid-out bounds, so a transform on the view around it moves the frame and
// not the paint — the same split the shape comment below describes for scale.
// A browser composites that transform before painting, and a compositor
// transform is what keeps a 2560x1440 subtree off the layout path for the
// whole swing.

import { useEffect } from "react";
import { Platform, View, StyleSheet, type ViewStyle } from "react-native";
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

// Every radial here is an ellipse, and the box it is painted into is what
// states its shape. Neither of the two ways of saying so on the gradient itself
// survives both platforms:
//
//   `rx`/`ry`  — what react-native-svg's native path actually reads, and what
//                SVG has no such attribute for, so every browser ignores them
//                and falls back to a circle.
//   `gradientTransform` — what a browser honours, and what the native path
//                pushes through a *user-space* matrix, where the unit-space
//                `translate(0.5, …)` that centres it means nothing.
//
//   `r="50%"` alone — a browser resolves that against the painted box and draws
//                the ellipse inscribed in it. The native path resolves it to a
//                single scalar (`rx: rx || r`, `ry: ry || r`) and draws a
//                *circle*, so a lamp anywhere but the middle of the bottom edge
//                lit a disc around the seat on move and left the rest of the
//                table as unlit room.
//
// So no radial here is ever asked to be an ellipse. Each is a circle in a
// square user space, and the *viewport* stretches that square into the ellipse
// — `preserveAspectRatio="none"`, which is the one instruction both paths
// agree on. A `transform: [{ scaleX }, { scaleY }]` on the view around the SVG
// is not: the native path paints at the view's own bounds and the scale never
// reaches the paint, so the pool came out as a bare disc round the lamp on iOS
// while a browser drew the ellipse. Nothing outside the square is left undrawn:
// the field's last stop and the room behind it are the same colour, and the
// core and the bloom end transparent.
//
// `none` alone, never `"none none"`: only the *align* half may be none. Setting
// meetOrSlice to none instead forces both scales to the smaller of the two and
// hands back the circle (apple/Utils/RNSVGViewBox.mm).
const PRESERVE_NONE = "none";
/** The square user space each radial is drawn in. Units, not pixels. */
const POOL_UNITS = 512;
const FIELD_RX = 0.76;
const FIELD_RY = 1.0;
const CORE_RX = 0.44;
const CORE_RY = 0.6;
const BLOOM_RX = 0.34;
const BLOOM_RY = 0.46;
const VIGNETTE_RX = 1.28;
const VIGNETTE_RY = 1.04;
// The sheen belongs to the pool, so it is drawn on the pool's own ellipse.
const NAP_RX = 0.76;
const NAP_RY = 1.0;

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
const RIM_MIX = 1;
const DARK_OFFSET = 1;

/**
 * A gradient stop's colour and its alpha, stated separately.
 *
 * react-native-svg's native path throws a stop colour's own alpha away —
 * `extractGradient.ts` builds each stop as `(color & 0x00ffffff) | (alpha << 24)`
 * where `alpha` comes from `stopOpacity`, which defaults to 1. So an
 * `rgba(0,0,0,0)` stop is opaque black on iOS and Android while a browser draws
 * it transparent, and the felt's vignette painted a solid black rectangle over
 * the whole table on device while every web check passed.
 */
export function stop(color: string): { stopColor: string; stopOpacity: number } {
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(
    color
  );
  if (!rgba) return { stopColor: color, stopOpacity: 1 };
  return {
    stopColor: `rgb(${rgba[1]}, ${rgba[2]}, ${rgba[3]})`,
    stopOpacity: rgba[4] === undefined ? 1 : Number(rgba[4]),
  };
}

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
const WEAVE_ID = "feltWeave";
const WEAVE_CROSS_ID = "feltWeaveCross";
const NAP_ID = "feltNap";

/** The cloth's weave: a 1px thread every 3px, crossing at 45 degrees. */
const WEAVE_PERIOD = 3;
const WEAVE_THREAD = 1;

/**
 * The pile's profile against distance from the lamp: nothing straight down the
 * fibres, the raking band where you see their sides, nothing again once the
 * light is no longer grazing.
 */
const NAP_OFFSETS = { under: 0, sheen: 0.5, lit: 0.86 } as const;

/** How long the lamp takes to swing to the seat that just came on move. */
const LAMP_MS = 800;

/**
 * The pool is twice the felt on each side — a 2560x1440 surface on a laptop —
 * and the swing moves it. Without its own compositor layer the browser
 * re-rasterises all of that on every frame of the swing, which is the whole
 * table stuttering every time the turn passes. Declared once rather than
 * toggled around the swing: the frame that creates the layer is the expensive
 * one, and creating it on the first frame of every swing is the cost this is
 * meant to remove.
 */
const POOL_LAYER =
  Platform.OS === "web" ? ({ willChange: "transform" } as unknown as ViewStyle) : null;

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

  const atLamp = () =>
    Platform.OS === "web"
      ? { transform: [{ translateX: x.value }, { translateY: y.value }] }
      : { left: x.value, top: y.value };

  const poolStyle = useAnimatedStyle(atLamp);
  // Its own hook, and the same two values: an animated style binds to one
  // view, so the nap cannot share the pool's. Reading the values rather than
  // running a second `withTiming` is what makes the two unable to part company
  // mid-swing.
  const napStyle = useAnimatedStyle(atLamp);

  // Each radial's own ellipse, `rx` by `ry` of the felt, centred on the point
  // it hangs from. The box is the SVG's own size, so the viewport is what
  // stretches the square — never a transform on a view around it.
  const ellipse = (rx: number, ry: number) => {
    const w = width * rx * 2;
    const h = height * ry * 2;
    return {
      width: w,
      height: h,
      style: { position: "absolute" as const, left: -w / 2, top: -h / 2 },
      viewBox: `0 0 ${POOL_UNITS} ${POOL_UNITS}`,
      preserveAspectRatio: PRESERVE_NONE,
    };
  };

  return (
    <View style={[StyleSheet.absoluteFill, feltStyles.clip]} pointerEvents="none">
      {/* Whatever the pool is not covering this frame — including a frame the
          browser has not finished painting it into, mid-swing on a slow
          machine. It is the colour the falloff ends at, so a missed paint is
          unlit cloth rather than a black rectangle over the whole table. */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: mix(stops[4], Colors.bg, RIM_MIX) }]} />

      {/* A point at the lamp. Its children hang off it centred, so each one is
          scaled about the light rather than about a corner — and the swing is
          this one anchor's position, not a transform per layer. */}
      <Animated.View
        testID="felt-lamp-anchor"
        style={[
          { position: "absolute", width: 0, height: 0 },
          POOL_LAYER,
          poolStyle,
        ]}
      >
        <Svg {...ellipse(FIELD_RX, FIELD_RY)}>
          <Defs>
            <RadialGradient id={FIELD_ID}>
              <Stop offset={FIELD_OFFSETS[0]} {...stop(stops[0])} />
              <Stop offset={FIELD_OFFSETS[1]} {...stop(stops[1])} />
              <Stop offset={FIELD_OFFSETS[2]} {...stop(stops[2])} />
              <Stop offset={FIELD_OFFSETS[3]} {...stop(stops[3])} />
              <Stop offset={FIELD_OFFSETS[4]} {...stop(stops[4])} />
              <Stop offset={TAIL_OFFSETS[0]} {...stop(mix(stops[4], Colors.bg, TAIL_MIX[0]))} />
              <Stop offset={TAIL_OFFSETS[1]} {...stop(mix(stops[4], Colors.bg, TAIL_MIX[1]))} />
              <Stop offset={DARK_OFFSET} {...stop(mix(stops[4], Colors.bg, RIM_MIX))} />
            </RadialGradient>
          </Defs>
          <Rect width={POOL_UNITS} height={POOL_UNITS} fill={`url(#${FIELD_ID})`} />
        </Svg>
        {/* The lamp itself, and its bloom. Each is its own square on its own
            box, so the three keep the ratios they were drawn at instead of
            all inheriting the field's. */}
        <Svg {...ellipse(CORE_RX, CORE_RY)}>
          <Defs>
            <RadialGradient id={CORE_ID}>
              <Stop offset={0} {...stop(Lantern.core)} />
              <Stop offset={0.46} {...stop(Lantern.coreMid)} />
              <Stop offset={0.78} {...stop(Lantern.clear)} />
            </RadialGradient>
          </Defs>
          <Rect width={POOL_UNITS} height={POOL_UNITS} fill={`url(#${CORE_ID})`} />
        </Svg>
        <Svg {...ellipse(BLOOM_RX, BLOOM_RY)}>
          <Defs>
            <RadialGradient id={BLOOM_ID}>
              <Stop offset={0} {...stop(Lantern.bloom)} />
              <Stop offset={0.76} {...stop(Lantern.clear)} />
            </RadialGradient>
          </Defs>
          <Rect width={POOL_UNITS} height={POOL_UNITS} fill={`url(#${BLOOM_ID})`} />
        </Svg>
      </Animated.View>

      {/* The cloth itself. It does not move with the lamp — a weave that
          travelled with the light would read as a moving surface — and it does
          not need to: both threads are shadow, so what they take away is a
          fraction of whatever light has reached them. */}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <Pattern
            id={WEAVE_ID}
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
              stroke={Lantern.weaveShade}
              strokeWidth={WEAVE_THREAD}
            />
          </Pattern>
          <Pattern
            id={WEAVE_CROSS_ID}
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
              stroke={Lantern.weaveShadeCross}
              strokeWidth={WEAVE_THREAD}
            />
          </Pattern>
        </Defs>
        <Rect width={width} height={height} fill={`url(#${WEAVE_ID})`} />
        <Rect width={width} height={height} fill={`url(#${WEAVE_CROSS_ID})`} />
      </Svg>

      {/* The pile, over the threads rather than under them: under them its own
          light would be shaded by the weave, and the sheen is the fibre ends
          catching the lamp on top of the cloth, not through it. */}
      <Animated.View
        testID="felt-nap-anchor"
        style={[{ position: "absolute", width: 0, height: 0 }, POOL_LAYER, napStyle]}
      >
        <Svg {...ellipse(NAP_RX, NAP_RY)}>
          <Defs>
            <RadialGradient id={NAP_ID}>
              <Stop offset={NAP_OFFSETS.under} {...stop(Lantern.clear)} />
              <Stop offset={NAP_OFFSETS.sheen} {...stop(Lantern.napSheen)} />
              <Stop offset={NAP_OFFSETS.lit} {...stop(Lantern.clear)} />
            </RadialGradient>
          </Defs>
          <Rect width={POOL_UNITS} height={POOL_UNITS} fill={`url(#${NAP_ID})`} />
        </Svg>
      </Animated.View>

      {/* Its own layer, and radial: a vignette assembled from straight-edged
          pieces carries ink along the edges facing the middle of the table and
          draws them as lines across the felt. */}
      <View
        style={[
          { position: "absolute", left: width / 2, top: height / 2, width: 0, height: 0 },
        ]}
      >
        <Svg {...ellipse(VIGNETTE_RX, VIGNETTE_RY)}>
          <Defs>
            <RadialGradient id={VIGNETTE_ID}>
              <Stop offset={0.4} {...stop(Lantern.vignetteClear)} />
              <Stop offset={1} {...stop(Lantern.vignette)} />
            </RadialGradient>
          </Defs>
          <Rect width={POOL_UNITS} height={POOL_UNITS} fill={`url(#${VIGNETTE_ID})`} />
        </Svg>
      </View>
    </View>
  );
}

const feltStyles = StyleSheet.create({
  // Every radial is painted into a box bigger than the felt and slid under this
  // one. Without the clip it is the document that grows on web, and the first
  // control to take focus scrolls the whole table off the screen.
  clip: { overflow: "hidden" },
});
