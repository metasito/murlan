// The felt, the rail and the lamp on them (#1252 § The felt, § The rail): one Skia canvas for the
// whole table. On web it is only ever reached through `feltSkia.web.tsx`'s lazy boundary, once
// CanvasKit has loaded — `Skia` is bound to it when this module is evaluated.
import { useCallback, useEffect, useMemo, useState } from "react";
import { PixelRatio, Platform, StyleSheet } from "react-native";
import {
  AlphaType,
  BlurMask,
  Canvas,
  ColorType,
  type CanvasRef,
  useCanvasRef,
  Group,
  Image,
  PaintStyle,
  Path,
  RadialGradient,
  Rect,
  RoundedRect,
  Shader,
  Skia,
  type SkImage,
  type SkPath,
  type SkRRect,
} from "@shopify/react-native-skia";
import { useDerivedValue, useSharedValue, type SharedValue } from "react-native-reanimated";
import type { FeltStops } from "@/lib/cosmetics";
import { useBenchHandle } from "@/lib/diagnostics";
import type { Pixels } from "@/lib/diagnostics/lampLegibility";
import { Colors, withAlpha } from "@/lib/theme";
import { DESIGN, lightUniforms, type Lamp } from "./lampRig";
import { CLOTH_SKSL, clothUniforms } from "./feltShader";
import { levelShade, paintRail, RAIL_BAND, RAIL_LIGHT, ringRect, ROOM, type RingPainter } from "./rail";
import { buildShadow, castOffset, SHADOW_PATHS, shadowPaint, type ShadowPath } from "./cardShadows";
import type { CardRects } from "./cardRects";
import type { FeltProps } from "./feltReady";
import { nameShade } from "./legibilityRing";
import type { CardTable } from "./useCardRects";

export interface FeltCanvasProps {
  lamp: SharedValue<Lamp>;
  sx: number;
  sy: number;
  stops: FeltStops;
  /** Called once the canvas has drawn its first frame. */
  onReady?: () => void;
  cards: CardTable;
  names: FeltProps["names"];
}

const CLOTH = Skia.RuntimeEffect.Make(CLOTH_SKSL);

// On Android `opaque` swaps the canvas for a SurfaceView; on iOS it needs the Skia patch.
const IOS = Platform.OS === "ios";

function ring(d: number): SkRRect {
  const r = ringRect(d);
  return { rect: { x: r.x, y: r.y, width: r.w, height: r.h }, rx: r.r, ry: r.r };
}

const OUTER = ring(0);
const FELT_EDGE = ring(RAIL_BAND);
const COAT = ring(RAIL_LIGHT.coatInset);
// A point into the rail: the cloth's antialiased edge lets the lit rail through, and the name must not stand on it.
const NAME_EDGE = ring(RAIL_BAND - 1);
/** The name shade's soft edge, in design points; it reaches three of them past the label box. */
const NAME_SOFT = 6;
// CanvasKit frees nothing itself; on native the host object's finalizer does.
const DISPOSE_PATHS = Platform.OS === "web";

function useShadowPath(kind: ShadowPath, rects: SharedValue<CardRects>, felt: CardTable["felt"], midX: number): SharedValue<SkPath> {
  const builder = useMemo(() => Skia.PathBuilder.Make(), []);
  const drawn = useSharedValue<SkPath | null>(null);
  return useDerivedValue(() => {
    builder.reset();
    buildShadow(builder, kind, rects.value, felt, midX);
    const path = builder.build();
    if (DISPOSE_PATHS) drawn.value?.dispose();
    drawn.value = path;
    return path;
  });
}

function ShadowLayer({ path, kind, s }: { path: SharedValue<SkPath>; kind: ShadowPath; s: number }) {
  const { sigma, alpha } = shadowPaint(kind);
  return (
    <Path path={path} color={withAlpha(Colors.shadow, alpha)}>
      <BlurMask blur={sigma * s} style="normal" />
    </Path>
  );
}

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

async function snapshotPixels(canvas: CanvasRef | null): Promise<Pixels | null> {
  const image = await canvas?.makeImageSnapshotAsync();
  if (!image) return null;
  const width = image.width();
  const height = image.height();
  const data = image.readPixels(0, 0, { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  image.dispose();
  return data instanceof Uint8Array ? { width, height, data } : null;
}

export function FeltCanvas({ lamp, sx, sy, stops, onReady, cards, names }: FeltCanvasProps) {
  const canvas = useCanvasRef();
  const snapshot = useCallback(() => snapshotPixels(canvas.current), [canvas]);
  useBenchHandle("feltSnapshot", snapshot);
  const [opaque, setOpaque] = useState(IOS);
  const flipOpaque = useCallback((on: boolean) => setOpaque(IOS && on), []);
  useBenchHandle("feltOpaque", flipOpaque);
  const k = PixelRatio.get() * Math.min(sx, sy);
  const rail = useMemo(() => bakeRail(k), [k]);
  // CanvasKit frees nothing itself. Skia commits the new image in a layout effect, before this cleanup.
  useEffect(() => () => rail?.dispose(), [rail]);
  const base = useMemo(() => clothUniforms(stops, k), [stops, k]);

  const uniforms = useDerivedValue(() => ({
    ...base,
    uLamp: [lamp.value.lx, lamp.value.ly],
    uFlare: lamp.value.f,
    ...lightUniforms(lamp.value.r),
  }));
  const light = useDerivedValue(() => ({ x: lamp.value.lx, y: lamp.value.ly }));
  const soft = useDerivedValue(() => RAIL_LIGHT.soft(lamp.value.f));
  const coat = useDerivedValue(() => RAIL_LIGHT.coat(lamp.value.f));
  const shade = useDerivedValue(() => levelShade(lamp.value.level));

  const { rects, felt } = cards;
  const s = felt.s;
  const paths = {
    cast: useShadowPath("cast", rects, felt, cards.hand.x),
    face: useShadowPath("face", rects, felt, cards.hand.x),
    back: useShadowPath("back", rects, felt, cards.hand.x),
    fan: useShadowPath("fan", rects, felt, cards.hand.x),
  };
  const pile = { x: cards.pile.x / sx, y: cards.pile.y / sy };
  const fall = useDerivedValue(() => {
    const o = castOffset(pile, { x: lamp.value.lx, y: lamp.value.ly });
    return [{ translateX: o.x * s }, { translateY: o.y * s }];
  });
  const contact = useMemo(() => [{ translateY: shadowPaint("face").dy * s }], [s]);
  const shadows = useSharedValue(1);
  useEffect(() => {
    if (process.env.EXPO_PUBLIC_E2E_FAST !== "1") return;
    const e2e = globalThis as { murlanCardShadows?: (on: boolean) => void };
    e2e.murlanCardShadows = (on) => (shadows.value = on ? 1 : 0);
    return () => void delete e2e.murlanCardShadows;
  }, [shadows]);
  const nameInk = useMemo(() => nameShade(stops, Colors.goldLit), [stops]);

  useEffect(() => {
    if (!onReady) return;
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(onReady);
    });
    return () => cancelAnimationFrame(id);
  }, [onReady]);

  const { width, height } = DESIGN;
  return (
    <Canvas ref={canvas} opaque={opaque} style={StyleSheet.absoluteFill} testID="felt-skia" pointerEvents="none">
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
        <Group clip={NAME_EDGE}>
          {names.map((n, i) => (
            <Rect key={i} x={n.x / sx - 3 * NAME_SOFT} y={n.y / sy - 3 * NAME_SOFT} width={n.w / sx + 6 * NAME_SOFT} height={n.h / sy + 6 * NAME_SOFT} color={nameInk} blendMode="darken">
              <BlurMask blur={NAME_SOFT} style="normal" />
            </Rect>
          ))}
        </Group>
        <Group transform={[{ scaleX: 1 / sx }, { scaleY: 1 / sy }]} opacity={shadows}>
          <Group transform={fall}>
            <ShadowLayer path={paths.cast} kind="cast" s={s} />
          </Group>
          <Group transform={contact}>
            {SHADOW_PATHS.filter((k) => k !== "cast").map((k) => (
              <ShadowLayer key={k} path={paths[k]} kind={k} s={s} />
            ))}
          </Group>
        </Group>
        <Rect x={0} y={0} width={width} height={height} color="black" opacity={shade} />
      </Group>
    </Canvas>
  );
}

export default FeltCanvas;
