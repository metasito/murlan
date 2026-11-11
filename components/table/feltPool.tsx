// The gliding lamp's light pool, on web: a gradient painted once on a 2D canvas, added over the Skia felt, that the lamp
// moves by transform and opacity alone, so the glide shades no cloth (#1989, GL; `glideLight.ts`).
import { useLayoutEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import Animated, { useAnimatedReaction, useAnimatedStyle } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import type { PoolProps } from "./feltCanvas";

/** The pool's colour and its falloff from the centre out, the felt's own green. */
const POOL_STOPS = [1, 0.75, 0.42, 0.15, 0];
/** Raw display-p3 components: the felt's drawing buffer is display-p3 and Skia writes `rgba(78,168,102)` into it unconverted (`feltEndB.tsx`). */
const POOL_RGB = [78, 168, 102].map((c) => (c / 255).toFixed(4)).join(" ");
/** The gradient's own pixels, scaled to the pool: it has no edge or detail to resolve. */
const PAINTED = 512;
/** Below what an 8-bit felt shows: the layer is taken off the page under it. */
const SHOWN = 1 / 512;

function paint(canvas: HTMLCanvasElement) {
  canvas.width = PAINTED;
  canvas.height = PAINTED;
  const context = canvas.getContext("2d", { colorSpace: "display-p3" }) ?? canvas.getContext("2d");
  if (!context) return;
  const half = PAINTED / 2;
  const gradient = context.createRadialGradient(half, half, 0, half, half, half);
  POOL_STOPS.forEach((k, i) => gradient.addColorStop(i / (POOL_STOPS.length - 1), `color(display-p3 ${POOL_RGB} / ${k})`));
  context.fillStyle = gradient;
  context.fillRect(0, 0, PAINTED, PAINTED);
}

export function FeltPool({ light, sx, sy, edge }: PoolProps) {
  const layer = useRef<HTMLCanvasElement>(null);
  const [on, setOn] = useState(false);
  useAnimatedReaction(
    () => light.value.o > SHOWN,
    (now, before) => {
      if (now !== before) scheduleOnRN(setOn, now);
    }
  );
  useLayoutEffect(() => {
    if (layer.current) paint(layer.current);
  }, []);
  const left = edge.x * sx;
  const top = edge.y * sy;
  const moved = useAnimatedStyle(() => {
    const { x, y, r, o } = light.value;
    return {
      opacity: o,
      transform: [{ translateX: x * sx - left }, { translateY: y * sy - top }, { scaleX: (r * sx) / PAINTED }, { scaleY: (r * sy) / PAINTED }],
    };
  }, [sx, sy, left, top]);
  return (
    <div
      data-testid="felt-pool"
      style={{
        position: "absolute",
        left,
        top,
        width: edge.w * sx,
        height: edge.h * sy,
        borderRadius: `${edge.r * sx}px / ${edge.r * sy}px`,
        overflow: "hidden",
        mixBlendMode: "plus-lighter",
        pointerEvents: "none",
        display: on ? "block" : "none",
      }}
    >
      <Animated.View pointerEvents="none" style={[styles.pool, moved]}>
        <canvas ref={layer} style={{ width: "100%", height: "100%" }} />
      </Animated.View>
    </div>
  );
}

const styles = StyleSheet.create({
  pool: { position: "absolute", left: -PAINTED, top: -PAINTED, width: 2 * PAINTED, height: 2 * PAINTED },
});
