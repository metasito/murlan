// The felt, the rail and the lamp on them (#1252 § The felt, § The rail): one Skia canvas for the
// whole table. On web it is only ever reached through `feltSkia.web.tsx`'s lazy boundary, once
// CanvasKit has loaded — `Skia` is bound to it when this module is evaluated.
import { useEffect, useMemo } from "react";
import { PixelRatio, StyleSheet } from "react-native";
import {
  Canvas,
  FillType,
  Group,
  Image,
  PaintStyle,
  Path,
  RadialGradient,
  Rect,
  Shader,
  Skia,
  type SkImage,
  type SkPath,
} from "@shopify/react-native-skia";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";
import type { FeltStops } from "@/lib/cosmetics";
import { DESIGN, type Lamp } from "./lampRig";
import { CLOTH_SKSL, clothUniforms } from "./feltShader";
import { paintRail, RAIL_BAND, RAIL_LIGHT, ringRect, ROOM, SHADE_MAX, type RingPainter } from "./rail";

export interface FeltCanvasProps {
  lamp: SharedValue<Lamp>;
  sx: number;
  sy: number;
  stops: FeltStops;
  /** Called once the canvas has drawn its first frame. */
  onReady?: () => void;
}

function ring(d: number): SkPath {
  const r = ringRect(d);
  return Skia.Path.Make().addRRect(Skia.RRectXY(Skia.XYWHRect(r.x, r.y, r.w, r.h), r.r, r.r));
}

function bakeRail(k: number): SkImage | null {
  const surface = Skia.Surface.MakeOffscreen(Math.round(DESIGN.width * k), Math.round(DESIGN.height * k));
  if (!surface) return null;
  const canvas = surface.getCanvas();
  canvas.scale(k, k);
  const painter: RingPainter = {
    ring(d, width, colour, dash) {
      const paint = Skia.Paint();
      paint.setAntiAlias(true);
      paint.setStyle(PaintStyle.Stroke);
      paint.setStrokeWidth(width);
      paint.setColor(Skia.Color(colour));
      if (dash) paint.setPathEffect(Skia.PathEffect.MakeDash(dash.intervals, dash.phase));
      canvas.drawPath(ring(d), paint);
    },
  };
  paintRail(painter);
  surface.flush();
  const image = surface.makeImageSnapshot();
  return image.makeNonTextureImage() ?? image;
}

export function FeltCanvas({ lamp, sx, sy, stops, onReady }: FeltCanvasProps) {
  const k = PixelRatio.get() * Math.min(sx, sy);
  const effect = useMemo(() => Skia.RuntimeEffect.Make(CLOTH_SKSL), []);
  const rail = useMemo(() => bakeRail(k), [k]);
  const band = useMemo(() => ring(0).addPath(ring(RAIL_BAND)).setFillType(FillType.EvenOdd), []);
  const coatPath = useMemo(() => ring(RAIL_LIGHT.coatInset), []);
  const base = useMemo(() => clothUniforms(stops, k), [stops, k]);

  const uniforms = useDerivedValue(() => ({ ...base, uLamp: [lamp.value.lx, lamp.value.ly], uFlare: lamp.value.f }));
  const light = useDerivedValue(() => ({ x: lamp.value.lx, y: lamp.value.ly }));
  const soft = useDerivedValue(() => RAIL_LIGHT.soft(lamp.value.f));
  const coat = useDerivedValue(() => RAIL_LIGHT.coat(lamp.value.f));
  const shade = useDerivedValue(() => (1 - lamp.value.level) * SHADE_MAX);

  useEffect(() => {
    if (!onReady) return;
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(onReady);
    });
    return () => cancelAnimationFrame(id);
  }, [onReady]);

  const { width, height } = DESIGN;
  return (
    <Canvas style={StyleSheet.absoluteFill} testID="felt-skia">
      <Group transform={[{ scaleX: sx }, { scaleY: sy }]}>
        <Rect x={0} y={0} width={width} height={height} color={ROOM} />
        {rail && <Image image={rail} x={0} y={0} width={width} height={height} />}
        <Group clip={band}>
          <Rect x={0} y={0} width={width} height={height} blendMode="softLight">
            <RadialGradient c={light} r={RAIL_LIGHT.softRadius} colors={soft} positions={RAIL_LIGHT.softStops} />
          </Rect>
        </Group>
        <Path path={coatPath} style="stroke" strokeWidth={RAIL_LIGHT.coatWidth}>
          <RadialGradient c={light} r={RAIL_LIGHT.coatRadius} colors={coat} />
        </Path>
        {effect && (
          <Rect x={0} y={0} width={width} height={height}>
            <Shader source={effect} uniforms={uniforms} />
          </Rect>
        )}
        <Rect x={0} y={0} width={width} height={height} color="black" opacity={shade} />
      </Group>
    </Canvas>
  );
}

export default FeltCanvas;
