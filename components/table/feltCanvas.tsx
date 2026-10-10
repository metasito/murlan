// The felt, the rail and the lamp on them (#1252 § The felt, § The rail): one Skia canvas for the
// whole table. On web it is only ever reached through `feltSkia.web.tsx`'s lazy boundary, once
// CanvasKit has loaded — `Skia` is bound to it when this module is evaluated.
import { useCallback, useEffect, useMemo, useState } from "react";
import { PixelRatio, Platform, StyleSheet } from "react-native";
import {
  AlphaType,
  BlurStyle,
  Canvas,
  ColorType,
  type CanvasRef,
  useCanvasRef,
  Group,
  Image,
  PaintStyle,
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
import { scheduleOnUI } from "react-native-worklets";
import type { FeltStops } from "@/lib/cosmetics";
import { useBenchHandle } from "@/lib/diagnostics";
import type { Pixels } from "@/lib/diagnostics/lampLegibility";
import { CardGlow, Colors, withAlpha } from "@/lib/theme";
import { DESIGN, lightUniforms, type Lamp } from "./lampRig";
import { useGreyLayer } from "./greyLayer";
import { CLOTH_SKSL, clothUniforms } from "./feltShader";
import { levelShade, paintRail, RAIL_BAND, RAIL_LIGHT, ringRect, ROOM, type RingPainter } from "./rail";
import { buildGlow, buildShadow, SHADOW_PATHS, shadowClusterId, shadowClusters, shadowFall, shadowShape, shadowPaint, shadowTransform, type GlowSink, type ShadowPath } from "./cardShadows";
import type { CardRects } from "./cardRects";
import type { CardTable } from "./useCardRects";

export interface FeltCanvasProps {
  lamp: SharedValue<Lamp>;
  sx: number;
  sy: number;
  stops: FeltStops;
  /** Called once the canvas has drawn its first frame. */
  onReady?: () => void;
  cards: CardTable;
  /** `useLinkHold`'s grey: drawn here on iOS only, where the view filter is not. */
  grey?: SharedValue<number>;
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
// CanvasKit frees nothing itself; on native the host object's finalizer does.
const DISPOSE_PATHS = Platform.OS === "web";

/** On web `stopMapper` waits on the UI queue, so a reaction can still run after an unmount's synchronous cleanup. */
function disposeAfterReactions(dispose: () => void) {
  if (DISPOSE_PATHS) scheduleOnUI(dispose);
}

function countBuild(counter: "murlanShadowBuilds" | "murlanGlowBuilds") {
  "worklet";
  const e2e = globalThis as { murlanShadowBuilds?: number; murlanGlowBuilds?: number };
  e2e[counter] = (e2e[counter] ?? 0) + 1;
}

function countClusterBuild(kind: ShadowPath, members: readonly string[]) {
  "worklet";
  const e2e = globalThis as { murlanShadowClusterBuilds?: Record<string, number> };
  const builds = (e2e.murlanShadowClusterBuilds ??= {});
  const cluster = `${kind}|${[...members].sort().join(",")}`;
  builds[cluster] = (builds[cluster] ?? 0) + 1;
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

const CAST: readonly ShadowPath[] = ["cast"];
const CONTACT = SHADOW_PATHS.filter((k) => k !== "cast");

function useShadowPicture(kinds: readonly ShadowPath[], shape: SharedValue<number>, rects: SharedValue<CardRects>, felt: CardTable["felt"], midX: number): SharedValue<SkPicture> {
  const recorder = useMemo(() => Skia.PictureRecorder(), []);
  const builder = useMemo(() => Skia.PathBuilder.Make(), []);
  const paints = useMemo(
    () =>
      kinds.map((kind) => {
        const { sigma, alpha } = shadowPaint(kind, felt.s);
        const paint = Skia.Paint();
        const blur = Skia.MaskFilter.MakeBlur(BlurStyle.Normal, sigma, true);
        paint.setAntiAlias(true);
        paint.setColor(Skia.Color(withAlpha(Colors.shadow, alpha)));
        paint.setMaskFilter(blur);
        // Skia's kernel stops at three sigma; the point more covers a pixel's rounding.
        return { paint, blur, reach: 3 * sigma + 1 };
      }),
    [kinds, felt.s]
  );
  useEffect(
    () => () =>
      disposeAfterReactions(() => {
        for (const { paint, blur } of paints) {
          paint.dispose();
          blur.dispose();
        }
      }),
    [paints]
  );
  const empty = useMemo(() => {
    recorder.beginRecording();
    return recorder.finishRecordingAsPicture();
  }, [recorder]);
  const drawn = useSharedValue<SkPicture>(empty);
  const paths = useSharedValue<Record<string, SkPath>>({});
  const e2e = process.env.EXPO_PUBLIC_E2E_FAST === "1";
  // A reaction, not a derived value: a mapper takes every shared value in its closure as an input, and one writing `drawn` re-ran each frame.
  // `rects` is read in the handler, outside the inputs, so a glow-only change builds nothing.
  useAnimatedReaction(
    () => shape.value,
    () => {
      const all = rects.value;
      const sets = kinds.map((kind, i) => shadowClusters(kind, all, felt, midX, paints[i].reach));
      if (drawn.value === empty && sets.every((s) => s.length === 0)) return;
      const canvas = recorder.beginRecording();
      const built = paths.value;
      const kept: Record<string, SkPath> = {};
      kinds.forEach((kind, i) => {
        for (const keys of sets[i]) {
          const id = shadowClusterId(kind, all, felt, midX, keys);
          let path = built[id];
          if (!path) {
            builder.reset();
            buildShadow(builder, kind, all, felt, midX, keys);
            path = builder.build();
            if (e2e) countClusterBuild(kind, keys);
          }
          kept[id] = path;
          canvas.drawPath(path, paints[i].paint);
        }
        if (e2e) countBuild("murlanShadowBuilds");
      });
      const last = drawn.value;
      drawn.value = recorder.finishRecordingAsPicture();
      paths.value = kept;
      if (!DISPOSE_PATHS) return;
      if (last !== empty) last.dispose();
      for (const id of Object.keys(built)) if (kept[id] !== built[id]) built[id].dispose();
    },
    [recorder, builder, paints, kinds, rects, felt, midX, empty, paths, e2e]
  );
  useEffect(
    () => () =>
      disposeAfterReactions(() => {
        if (drawn.value !== empty) drawn.value.dispose();
        for (const path of Object.values(paths.value)) path.dispose();
        empty.dispose();
        builder.dispose();
        recorder.dispose();
      }),
    [recorder, builder, drawn, empty, paths]
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
    () => () =>
      disposeAfterReactions(() => {
        paint.dispose();
        blur.dispose();
      }),
    [paint, blur]
  );
  const empty = useMemo(() => {
    recorder.beginRecording();
    return recorder.finishRecordingAsPicture();
  }, [recorder]);
  const drawn = useSharedValue<SkPicture>(empty);
  const lit = useSharedValue(false);
  const e2e = process.env.EXPO_PUBLIC_E2E_FAST === "1";
  useAnimatedReaction(
    () => rects.value,
    (all) => {
      const any = Object.keys(all).some((k) => all[k].glow > 0);
      if (!any && !lit.value) return;
      lit.value = any;
      const last = drawn.value;
      if (!any) {
        drawn.value = empty;
        if (e2e) countBuild("murlanGlowBuilds");
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
      if (e2e) countBuild("murlanGlowBuilds");
      if (DISPOSE_PATHS && last !== empty) last.dispose();
    },
    [recorder, builder, paint, empty, felt, midX, e2e]
  );
  useEffect(
    () => () =>
      disposeAfterReactions(() => {
        if (drawn.value !== empty) drawn.value.dispose();
        empty.dispose();
        builder.dispose();
        recorder.dispose();
      }),
    [recorder, builder, drawn, empty]
  );
  return drawn;
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

export function FeltCanvas({ lamp, sx, sy, stops, onReady, cards, grey }: FeltCanvasProps) {
  const greyLayer = useGreyLayer(grey);
  const canvas = useCanvasRef();
  const snapshot = useCallback(() => snapshotPixels(canvas.current), [canvas]);
  useBenchHandle("feltSnapshot", snapshot);
  const [opaque, setOpaque] = useState(IOS);
  const flipOpaque = useCallback((on: boolean) => setOpaque(IOS && on), []);
  useBenchHandle("feltOpaque", flipOpaque);
  const k = PixelRatio.get() * Math.min(sx, sy);
  const rail = useMemo(() => bakeRail(k), [k]);
  // CanvasKit frees nothing itself. Skia commits the new image in a layout effect, before this cleanup.
  useEffect(() => () => (DISPOSE_PATHS ? disposeAfterReactions(() => rail?.dispose()) : rail?.dispose()), [rail]);
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
  const shape = useShadowShape(rects);
  const cast = useShadowPicture(CAST, shape, rects, felt, cards.hand.x);
  const contacts = useShadowPicture(CONTACT, shape, rects, felt, cards.hand.x);
  const glow = useGlow(rects, felt, cards.hand.x);
  const pile = { x: cards.pile.x / sx, y: cards.pile.y / sy };
  const fall = useDerivedValue(() => shadowTransform(shadowFall("cast", pile, { x: lamp.value.lx, y: lamp.value.ly }), felt));
  const contact = shadowTransform(shadowFall("face", pile, pile), felt);
  const flat = shadowTransform({ x: 0, y: 0 }, felt);
  // State, not a group's opacity: a picture is drawn without the group's paint.
  const [shadows, setShadows] = useState(true);
  const [glows, setGlows] = useState(true);
  useEffect(() => {
    if (process.env.EXPO_PUBLIC_E2E_FAST !== "1") return;
    const e2e = globalThis as { murlanCardShadows?: (on: boolean) => void; murlanCardGlow?: (on: boolean) => void };
    e2e.murlanCardShadows = setShadows;
    e2e.murlanCardGlow = setGlows;
    return () => {
      delete e2e.murlanCardShadows;
      delete e2e.murlanCardGlow;
    };
  }, []);

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
      <Group transform={[{ scaleX: sx }, { scaleY: sy }]} layer={greyLayer}>
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
        {glows && (
          <Group transform={flat}>
            <Picture picture={glow} />
          </Group>
        )}
        {shadows && (
          <>
            <Group transform={fall}>
              <Picture picture={cast} />
            </Group>
            <Group transform={contact}>
              <Picture picture={contacts} />
            </Group>
          </>
        )}
        <Rect x={0} y={0} width={width} height={height} color="black" opacity={shade} />
      </Group>
    </Canvas>
  );
}

export default FeltCanvas;
