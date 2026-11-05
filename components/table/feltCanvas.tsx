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
  processUniforms,
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
import { scheduleOnRN } from "react-native-worklets";
import type { FeltStops } from "@/lib/cosmetics";
import { useBenchHandle } from "@/lib/diagnostics";
import { E2E_FAST } from "@/lib/e2eConfig";
import type { Pixels } from "@/lib/diagnostics/lampLegibility";
import { CardGlow, Colors, withAlpha } from "@/lib/theme";
import { DESIGN, LIGHT_ABOVE, lightUniforms, SWAY, type Lamp, type Pool } from "./lampRig";
import { useGreyLayer } from "./greyLayer";
import { CLOTH_SKSL, clothUniforms, type ClothUniforms } from "./feltShader";
import { levelShade, paintRail, RAIL_BAND, RAIL_LIGHT, ringRect, ROOM, type RingPainter } from "./rail";
import { buildGlow, buildShadow, SHADOW_PATHS, shadowClusterId, shadowClusters, shadowFall, shadowShape, shadowPaint, shadowTransform, type GlowSink, type ShadowPath } from "./cardShadows";
import type { CardRects } from "./cardRects";
import type { CardTable } from "./useCardRects";
import { useCardShadowsOn } from "./feltReady";
import { DISPOSE_PATHS, disposeAfterReactions } from "./skiaDispose";
import { webDeps } from "@/lib/platform";

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

function countBuild(counter: "murlanShadowBuilds" | "murlanGlowBuilds") {
  "worklet";
  const e2e = globalThis as { murlanShadowBuilds?: number; murlanGlowBuilds?: number };
  e2e[counter] = (e2e[counter] ?? 0) + 1;
}

// Out of the hook, so the React Compiler cannot lift its callback out of the worklet (tests/ui-rules/workletHoisting.test.ts).
function noClusters(sets: readonly (readonly unknown[])[]): boolean {
  "worklet";
  return sets.every((s) => s.length === 0);
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
  const e2e = E2E_FAST;
  // A reaction, not a derived value: a mapper takes every shared value in its closure as an input, and one writing `drawn` re-ran each frame.
  // `rects` is read in the handler, outside the inputs, so a glow-only change builds nothing.
  useAnimatedReaction(
    () => shape.value,
    () => {
      const all = rects.value;
      const sets = kinds.map((kind, i) => shadowClusters(kind, all, felt, midX, paints[i].reach));
      if (drawn.value === empty && noClusters(sets)) return;
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
    webDeps([recorder, builder, paints, kinds, rects, felt, midX, empty, paths, e2e])
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
  const e2e = E2E_FAST;
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
    webDeps([recorder, builder, paint, empty, felt, midX, e2e])
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

/** Where the lamp has come to rest, as a key: its glide spent, whatever its sway or flare. `""` while it still moves. */
function settledAim(s: Lamp): string {
  "worklet";
  const near = Math.abs(s.x - s.tx) < 3 && Math.abs(s.y - s.ty) < 3 && Math.abs(s.r - s.tr) < 0.02;
  return near ? `${s.tx},${s.ty},${s.tr}` : "";
}

const CACHED_CLOTHS = 6;
const FLARE_SEEN = 0.005;
const FLARE_WARM = [255, 199, 115] as const;
const FLARE_POSITIONS = [0, 0.2, 0.4, 0.6, 0.8, 1];

/** False only when the readback proves the baked cloth blank at the felt's centre; a build that cannot read pixels back keeps its bake. */
function litAtCentre(image: SkImage, ax: number, ay: number): boolean {
  const x = Math.min(image.width() - 1, Math.round((DESIGN.width / 2) * ax));
  const y = Math.min(image.height() - 1, Math.round((DESIGN.height / 2) * ay));
  const px = image.readPixels(x, y, { width: 1, height: 1, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  return !(px instanceof Uint8Array) || (px[3] > 0 && px[0] + px[1] + px[2] > 24);
}

/** The cloth lit with the lamp `lean` points off its target, in the device pixels the live shader would fill; `null` where no offscreen surface can be made. */
function bakeCloth(aim: Pool, base: ClothUniforms, ax: number, ay: number, lean: number): SkImage | null {
  if (!CLOTH) return null;
  const surface = Skia.Surface.MakeOffscreen(Math.round(DESIGN.width * ax), Math.round(DESIGN.height * ay));
  if (!surface) return null;
  const [tx, ty, reach] = aim;
  const uniforms = { ...base, uLamp: [tx + lean, ty - LIGHT_ABOVE], uFlare: 0, ...lightUniforms(reach) };
  const shader = CLOTH.makeShader(processUniforms(CLOTH, uniforms));
  const paint = Skia.Paint();
  paint.setShader(shader);
  const canvas = surface.getCanvas();
  canvas.scale(ax, ay);
  canvas.drawRect(Skia.XYWHRect(0, 0, DESIGN.width, DESIGN.height), paint);
  surface.flush();
  const snapshot = surface.makeImageSnapshot();
  // A snapshot is a texture of this surface's context: it dies with the context on web, and on iOS reads black once the surface is disposed below. Copy it to the CPU while the surface is alive.
  const image = snapshot.makeNonTextureImage();
  snapshot.dispose();
  const painted = image !== null && litAtCentre(image, ax, ay);
  paint.dispose();
  shader.dispose();
  surface.dispose();
  if (image && !painted) image.dispose();
  return painted ? image : null;
}

/** The most recently used cloths, so a lamp that returns to a target it has lit already redraws nothing. */
class ClothCache {
  private images = new Map<string, SkImage>();

  get(key: string, bake: () => SkImage | null): SkImage | null {
    const hit = this.images.get(key) ?? bake();
    this.images.delete(key);
    if (!hit) return null;
    this.images.set(key, hit);
    for (const [oldest, image] of this.images) {
      if (this.images.size <= CACHED_CLOTHS) break;
      this.images.delete(oldest);
      disposeAfterReactions(() => image.dispose());
    }
    return hit;
  }

  dispose() {
    const all = [...this.images.values()];
    for (const key of [...this.images.keys()]) this.images.delete(key);
    disposeAfterReactions(() => all.forEach((image) => image.dispose()));
  }
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

  const [aim, setAim] = useState("");
  const [flaring, setFlaring] = useState(false);
  useAnimatedReaction(
    () => lamp.value.f > FLARE_SEEN,
    (now, before) => {
      if (now !== before) scheduleOnRN(setFlaring, now);
    }
  );
  useAnimatedReaction(
    () => settledAim(lamp.value),
    (now, before) => {
      if (now !== before) scheduleOnRN(setAim, now);
    }
  );
  const ax = PixelRatio.get() * sx;
  const ay = PixelRatio.get() * sy;
  const [cloths] = useState(() => new ClothCache());
  const cloth = useMemo(() => {
    if (!aim) return null;
    const target = aim.split(",").map(Number) as unknown as Pool;
    const lit = (lean: number) => cloths.get(`${aim}|${ax}|${ay}|${stops.join()}|${lean}`, () => bakeCloth(target, base, ax, ay, lean));
    const left = lit(-SWAY);
    const right = lit(SWAY);
    return left && right ? { left, right } : null;
  }, [cloths, aim, ax, ay, stops, base]);
  // The lamp's sway crosses the cloth lit at either end of it.
  const lean = useDerivedValue(() => Math.min(1, Math.max(0, 0.5 + (lamp.value.lx - lamp.value.tx) / (2 * SWAY))));
  useEffect(() => () => cloths.dispose(), [cloths]);

  const uniforms = useDerivedValue(() => ({
    ...base,
    uLamp: [lamp.value.lx, lamp.value.ly],
    uFlare: lamp.value.f,
    ...lightUniforms(lamp.value.r),
  }));
  // The cloth shader's flare term, added over the baked cloth: the warm core, `pow(1 - t, 2)` of it.
  const flareColors = useDerivedValue(() =>
    FLARE_POSITIONS.map((t) => `rgba(${FLARE_WARM.join(",")},${(0.35 * lamp.value.f * (1 - t) * (1 - t)).toFixed(3)})`)
  );
  const flareReach = useDerivedValue(() => lightUniforms(lamp.value.r).uPoolR + lamp.value.f * 120);
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
  const shadows = useCardShadowsOn();
  const [glows, setGlows] = useState(true);
  useEffect(() => {
    if (!E2E_FAST) return;
    const e2e = globalThis as { murlanCardGlow?: (on: boolean) => void };
    e2e.murlanCardGlow = setGlows;
    return () => {
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
        {cloth ? (
          <>
            <Image image={cloth.left} x={0} y={0} width={width} height={height} />
            <Image image={cloth.right} x={0} y={0} width={width} height={height} opacity={lean} />
            {flaring && (
              <Rect x={0} y={0} width={width} height={height} blendMode="plus">
                <RadialGradient c={light} r={flareReach} colors={flareColors} positions={FLARE_POSITIONS} />
              </Rect>
            )}
          </>
        ) : (
          CLOTH && (
            <Rect x={0} y={0} width={width} height={height}>
              <Shader source={CLOTH} uniforms={uniforms} />
            </Rect>
          )
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
