// The felt, the rail and the lamp on them (#1252 § The felt, § The rail): one Skia canvas for the
// whole table. On web it is only ever reached through `feltSkia.web.tsx`'s lazy boundary, once
// CanvasKit has loaded — `Skia` is bound to it when this module is evaluated.
import { useCallback, useEffect, useMemo, useState } from "react";
import { PixelRatio, Platform, StyleSheet } from "react-native";
import {
  AlphaType,
  BlurMask,
  BlurStyle,
  Canvas,
  ColorType,
  type CanvasRef,
  useCanvasRef,
  Group,
  Image,
  PaintStyle,
  Path,
  Picture,
  RadialGradient,
  Rect,
  RoundedRect,
  Shader,
  Skia,
  type SkImage,
  type SkPath,
  type SkPicture,
  type SkRRect,
} from "@shopify/react-native-skia";
import { useAnimatedReaction, useDerivedValue, useSharedValue, type SharedValue } from "react-native-reanimated";
import type { FeltStops } from "@/lib/cosmetics";
import { useBenchHandle } from "@/lib/diagnostics";
import type { Pixels } from "@/lib/diagnostics/lampLegibility";
import { CardGlow, Colors, withAlpha } from "@/lib/theme";
import { DESIGN, lightUniforms, type Lamp } from "./lampRig";
import { CLOTH_SKSL, clothUniforms, rgb } from "./feltShader";
import { levelShade, paintRail, RAIL_BAND, RAIL_LIGHT, ringRect, ROOM, type RingPainter } from "./rail";
import { buildGlow, buildShadow, SHADOW_PATHS, shadowFall, shadowShape, shadowPaint, shadowTransform, type GlowSink, type ShadowPath } from "./cardShadows";
import type { CardRects } from "./cardRects";
import type { FeltProps } from "./feltReady";
import { feltLight, nameCeiling, nameDim } from "./legibilityRing";
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
const E2E = process.env.EXPO_PUBLIC_E2E_FAST === "1";

function countBuild(counter: "murlanShadowBuilds" | "murlanGlowBuilds") {
  "worklet";
  const e2e = globalThis as { murlanShadowBuilds?: number; murlanGlowBuilds?: number };
  e2e[counter] = (e2e[counter] ?? 0) + 1;
}

/** Moves on when a card's outline does, and not when only its lift or glow does. */
function useShadowShape(rects: SharedValue<CardRects>): SharedValue<number> {
  const version = useSharedValue(0);
  const last = useSharedValue("");
  useAnimatedReaction(
    () => rects.value,
    (all) => {
      const shape = shadowShape(all);
      if (shape === last.value) return;
      last.value = shape;
      version.value += 1;
    }
  );
  return version;
}

function useShadowPath(kind: ShadowPath, shape: SharedValue<number>, rects: SharedValue<CardRects>, felt: CardTable["felt"], midX: number): SharedValue<SkPath> {
  const builder = useMemo(() => Skia.PathBuilder.Make(), []);
  const empty = useMemo(() => Skia.Path.Make(), []);
  const drawn = useSharedValue<SkPath>(empty);
  // A reaction, not a derived value: a mapper takes every shared value in its closure as an input, and one writing `drawn` re-ran each frame.
  // `rects` is read in the handler, outside the inputs, so a glow-only change builds nothing.
  useAnimatedReaction(
    () => shape.value,
    () => {
      builder.reset();
      buildShadow(builder, kind, rects.value, felt, midX);
      const last = drawn.value;
      drawn.value = builder.build();
      if (E2E) countBuild("murlanShadowBuilds");
      if (DISPOSE_PATHS) last.dispose();
    },
    [builder, kind, rects, felt, midX]
  );
  useEffect(
    () => () => {
      if (!DISPOSE_PATHS) return;
      drawn.value.dispose();
      builder.dispose();
    },
    [builder, drawn]
  );
  return drawn;
}

function useGlow(rects: SharedValue<CardRects>, felt: CardTable["felt"], midX: number): SharedValue<SkPicture> {
  const recorder = useMemo(() => Skia.PictureRecorder(), []);
  const builder = useMemo(() => Skia.PathBuilder.Make(), []);
  const [paint, blur] = useMemo(() => {
    const p = Skia.Paint();
    const b = Skia.MaskFilter.MakeBlur(BlurStyle.Normal, (CardGlow.blur / 2) * felt.s, true);
    p.setAntiAlias(true);
    p.setColor(Skia.Color(CardGlow.color));
    p.setMaskFilter(b);
    return [p, b] as const;
  }, [felt.s]);
  useEffect(
    () => () => {
      if (!DISPOSE_PATHS) return;
      paint.dispose();
      blur.dispose();
    },
    [paint, blur]
  );
  const empty = useMemo(() => {
    recorder.beginRecording();
    return recorder.finishRecordingAsPicture();
  }, [recorder]);
  const drawn = useSharedValue<SkPicture>(empty);
  const lit = useSharedValue(false);
  useAnimatedReaction(
    () => rects.value,
    (all) => {
      const any = Object.keys(all).some((k) => all[k].glow > 0);
      if (!any && !lit.value) return;
      lit.value = any;
      const last = drawn.value;
      if (!any) {
        drawn.value = empty;
        if (E2E) countBuild("murlanGlowBuilds");
        if (DISPOSE_PATHS) last.dispose();
        return;
      }
      const canvas = recorder.beginRecording();
      builder.reset();
      const sink: GlowSink = {
        moveTo: (x, y) => builder.moveTo(x, y),
        lineTo: (x, y) => builder.lineTo(x, y),
        conicTo: (x1, y1, x2, y2, w) => builder.conicTo(x1, y1, x2, y2, w),
        close: () => builder.close(),
        fill: (alpha) => {
          const path = builder.build();
          builder.reset();
          paint.setAlphaf(alpha);
          canvas.drawPath(path, paint);
          if (DISPOSE_PATHS) path.dispose();
        },
      };
      buildGlow(sink, all, felt, midX);
      drawn.value = recorder.finishRecordingAsPicture();
      if (E2E) countBuild("murlanGlowBuilds");
      if (DISPOSE_PATHS && last !== empty) last.dispose();
    },
    [recorder, builder, paint, empty, felt, midX]
  );
  useEffect(
    () => () => {
      if (!DISPOSE_PATHS) return;
      if (drawn.value !== empty) drawn.value.dispose();
      empty.dispose();
      builder.dispose();
      recorder.dispose();
    },
    [recorder, builder, drawn, empty]
  );
  return drawn;
}

function ShadowLayer({ path, kind, s }: { path: SharedValue<SkPath>; kind: ShadowPath; s: number }) {
  const { sigma, alpha } = shadowPaint(kind, s);
  return (
    <Path path={path} color={withAlpha(Colors.shadow, alpha)}>
      <BlurMask blur={sigma} style="normal" />
    </Path>
  );
}

/** `box` in design points; dimmed by as much as the light at its point nearest the lamp needs. */
function NameDim({ box, ceiling, cloth, lamp }: { box: { x: number; y: number; w: number; h: number }; ceiling: number; cloth: number[][]; lamp: SharedValue<Lamp> }) {
  const grey = useDerivedValue(() => {
    const { lx, ly } = lamp.value;
    const near = { x: Math.min(Math.max(lx, box.x), box.x + box.w), y: Math.min(Math.max(ly, box.y), box.y + box.h) };
    const g = Math.round(255 * nameDim(feltLight(cloth, lamp.value, near), ceiling));
    return `rgb(${g},${g},${g})`;
  });
  return (
    <Rect x={box.x - 3 * NAME_SOFT} y={box.y - 3 * NAME_SOFT} width={box.w + 6 * NAME_SOFT} height={box.h + 6 * NAME_SOFT} color={grey} blendMode="multiply">
      <BlurMask blur={NAME_SOFT} style="normal" />
    </Rect>
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
  const shape = useShadowShape(rects);
  const paths = {
    cast: useShadowPath("cast", shape, rects, felt, cards.hand.x),
    face: useShadowPath("face", shape, rects, felt, cards.hand.x),
    back: useShadowPath("back", shape, rects, felt, cards.hand.x),
    fan: useShadowPath("fan", shape, rects, felt, cards.hand.x),
  };
  const glow = useGlow(rects, felt, cards.hand.x);
  const pile = { x: cards.pile.x / sx, y: cards.pile.y / sy };
  const fall = useDerivedValue(() => shadowTransform(shadowFall("cast", pile, { x: lamp.value.lx, y: lamp.value.ly }), felt));
  const contact = shadowTransform(shadowFall("face", pile, pile), felt);
  const flat = shadowTransform({ x: 0, y: 0 }, felt);
  const shadows = useSharedValue(1);
  // State, not a group's opacity: a picture is drawn without the group's paint.
  const [glows, setGlows] = useState(true);
  useEffect(() => {
    if (process.env.EXPO_PUBLIC_E2E_FAST !== "1") return;
    const e2e = globalThis as { murlanCardShadows?: (on: boolean) => void; murlanCardGlow?: (on: boolean) => void; murlanNameShade?: () => FeltProps["names"] };
    e2e.murlanCardShadows = (on) => (shadows.value = on ? 1 : 0);
    e2e.murlanCardGlow = setGlows;
    e2e.murlanNameShade = () => names;
    return () => {
      delete e2e.murlanCardShadows;
      delete e2e.murlanCardGlow;
      delete e2e.murlanNameShade;
    };
  }, [shadows, names]);
  const ceilings = useMemo(() => ({ lit: nameCeiling(stops, Colors.goldLit), unlit: nameCeiling(stops, Colors.textMuted) }), [stops]);
  const cloth = useMemo(() => stops.map(rgb), [stops]);

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
            <NameDim key={i} box={{ x: n.x / sx, y: n.y / sy, w: n.w / sx, h: n.h / sy }} ceiling={n.lit ? ceilings.lit : ceilings.unlit} cloth={cloth} lamp={lamp} />
          ))}
        </Group>
        {glows && (
          <Group transform={flat}>
            <Picture picture={glow} />
          </Group>
        )}
        <Group opacity={shadows}>
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
