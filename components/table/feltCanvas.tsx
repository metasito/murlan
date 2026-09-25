// The felt, the rail and the lamp on them (#1252 § The felt, § The rail): one Skia canvas for the
// whole table. On web it is only ever reached through `feltSkia.web.tsx`'s lazy boundary, once
// CanvasKit has loaded — `Skia` is bound to it when this module is evaluated.
import { useEffect, useMemo } from "react";
import { PixelRatio, StyleSheet } from "react-native";
import {
  Canvas,
  Group,
  Image,
  PaintStyle,
  RadialGradient,
  Rect,
  RoundedRect,
  Shader,
  Skia,
  type SkImage,
  type SkRRect,
} from "@shopify/react-native-skia";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";
import type { FeltStops } from "@/lib/cosmetics";
import { DESIGN, type Lamp } from "./lampRig";
import { CLOTH_SKSL, clothUniforms } from "./feltShader";
import { levelShade, paintRail, RAIL_BAND, RAIL_LIGHT, ringRect, ROOM, type RingPainter } from "./rail";

export interface FeltCanvasProps {
  lamp: SharedValue<Lamp>;
  sx: number;
  sy: number;
  stops: FeltStops;
  /** Called once the canvas has drawn its first frame. */
  onReady?: () => void;
}

const CLOTH = Skia.RuntimeEffect.Make(CLOTH_SKSL);

function ring(d: number): SkRRect {
  const r = ringRect(d);
  return { rect: { x: r.x, y: r.y, width: r.w, height: r.h }, rx: r.r, ry: r.r };
}

const OUTER = ring(0);
const FELT_EDGE = ring(RAIL_BAND);
const COAT = ring(RAIL_LIGHT.coatInset);

// A raster surface: on web an offscreen one is a WebGL context of its own per bake, read back
// with a GPU stall.
function bakeRail(k: number): SkImage | null {
  const surface = Skia.Surface.Make(Math.round(DESIGN.width * k), Math.round(DESIGN.height * k));
  if (!surface) return null;
  const canvas = surface.getCanvas();
  canvas.scale(k, k);
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setStyle(PaintStyle.Stroke);
  const painter: RingPainter = {
    ring(d, width, colour, dash) {
      const dashes = dash ? Skia.PathEffect.MakeDash(dash.intervals, dash.phase) : null;
      paint.setStrokeWidth(width);
      paint.setColor(Skia.Color(colour));
      paint.setPathEffect(dashes);
      canvas.drawRRect(ring(d), paint);
      dashes?.dispose();
    },
  };
  paintRail(painter);
  surface.flush();
  const image = surface.makeImageSnapshot();
  paint.dispose();
  surface.dispose();
  return image;
}

export function FeltCanvas({ lamp, sx, sy, stops, onReady }: FeltCanvasProps) {
  const k = PixelRatio.get() * Math.min(sx, sy);
  const rail = useMemo(() => bakeRail(k), [k]);
  // CanvasKit frees nothing itself. Skia commits the new image in a layout effect, before this cleanup.
  useEffect(() => () => rail?.dispose(), [rail]);
  const base = useMemo(() => clothUniforms(stops, k), [stops, k]);

  const uniforms = useDerivedValue(() => ({ ...base, uLamp: [lamp.value.lx, lamp.value.ly], uFlare: lamp.value.f }));
  const light = useDerivedValue(() => ({ x: lamp.value.lx, y: lamp.value.ly }));
  const soft = useDerivedValue(() => RAIL_LIGHT.soft(lamp.value.f));
  const coat = useDerivedValue(() => RAIL_LIGHT.coat(lamp.value.f));
  const shade = useDerivedValue(() => levelShade(lamp.value.level));

  useEffect(() => {
    if (!onReady) return;
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(onReady);
    });
    return () => cancelAnimationFrame(id);
  }, [onReady]);

  const { width, height } = DESIGN;
  return (
    <Canvas style={StyleSheet.absoluteFill} testID="felt-skia" pointerEvents="none">
      <Group transform={[{ scaleX: sx }, { scaleY: sy }]}>
        <Rect x={0} y={0} width={width} height={height} color={ROOM} />
        {rail && <Image image={rail} x={0} y={0} width={width} height={height} />}
        <Group clip={OUTER}>
          <Group clip={FELT_EDGE} invertClip>
            <Rect x={0} y={0} width={width} height={height} blendMode="softLight">
              <RadialGradient c={light} r={RAIL_LIGHT.softRadius} colors={soft} positions={RAIL_LIGHT.softStops} />
            </Rect>
          </Group>
        </Group>
        <RoundedRect rect={COAT} style="stroke" strokeWidth={RAIL_LIGHT.coatWidth}>
          <RadialGradient c={light} r={RAIL_LIGHT.coatRadius} colors={coat} />
        </RoundedRect>
        {CLOTH && (
          <Rect x={0} y={0} width={width} height={height}>
            <Shader source={CLOTH} uniforms={uniforms} />
          </Rect>
        )}
        <Rect x={0} y={0} width={width} height={height} color="black" opacity={shade} />
      </Group>
    </Canvas>
  );
}

export default FeltCanvas;
