// The felt, the rail and the lamp on them (#1252 § The felt, § The rail): one Skia canvas for the
// whole table. On web it is only ever reached through `feltSkia.web.tsx`'s lazy boundary, once
// CanvasKit has loaded — `Skia` is bound to it when this module is evaluated.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef, type ComponentType, type RefObject } from "react";
import { PixelRatio, Platform, StyleSheet, View } from "react-native";
import {
  AlphaType,
  BlurStyle,
  Canvas,
  ColorType,
  type CanvasRef,
  FilterMode,
  useCanvasRef,
  Group,
  Image,
  ImageShader,
  MipmapMode,
  PaintStyle,
  Picture,
  processUniforms,
  RadialGradient,
  Rect,
  RoundedRect,
  Shader,
  Skia,
  type SkCanvas,
  type SkImage,
  type SkPath,
  type SkPicture,
  type SkRRect,
  type SkShader,
  type SkSurface,
  TileMode,
} from "@shopify/react-native-skia";
import { ReduceMotion, useAnimatedReaction, useDerivedValue, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN, scheduleOnUI } from "react-native-worklets";
import type { FeltStops } from "@/lib/cosmetics";
import { useBenchHandle } from "@/lib/diagnostics";
import { E2E_FAST } from "@/lib/e2eConfig";
import { useTraceSource } from "@/lib/e2eTrace";
import type { Pixels } from "@/lib/diagnostics/lampLegibility";
import { CardGlow, Colors, motionMs, withAlpha } from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { afterFrames } from "@/lib/motion";
import { DESIGN, LIGHT_ABOVE, lightUniforms, SWAY, type Lamp, type LampNow, type Pool } from "./lampRig";
import { NOT_SHOWN, nextShown, type Shown } from "./restEnds";
import { glideCloth, SETTLED_PT } from "./glideLight";
import type { GlossTracks } from "./glossTrackStore";
import { useGreyLayer } from "./greyLayer";
import { CLOTH_SKSL, clothUniforms, flareShare, HAND_CLOTH_SKSL, HAND_LIT_SKSL, LIT_SKSL, opaquePlane, REST_SKSL, settledDraws, WEAVE_PLANES, WEAVE_SKSL, weaveUniforms, type ClothUniforms } from "./feltShader";
import { levelShade, paintRail, RAIL_BAND, RAIL_LIGHT, ringRect, ROOM } from "./rail";
import { buildGlow, buildShadow, SHADOW_PATHS, shadowClusterId, shadowClusters, shadowFall, shadowShape, shadowPaint, shadowTransform, type GlowSink, type ShadowPath } from "./cardShadows";
import type { CardRects } from "./cardRects";
import type { CardTable } from "./useCardRects";
import { useCardShadowsOn } from "./feltReady";
import { DISPOSE_PATHS, disposeAfterReactions } from "./skiaDispose";
import { webDeps } from "@/lib/platform";

export interface FeltCanvasProps {
  /** The rig's own lamp, read to run when the rig writes; what the canvas draws is `now()`. */
  lamp: SharedValue<Lamp>;
  now: LampNow["now"];
  sx: number;
  sy: number;
  stops: FeltStops;
  /** Called once the canvas has drawn its first frame. */
  onReady?: () => void;
  cards: CardTable;
  /** `useLinkHold`'s grey: drawn here on iOS only, where the view filter is not. */
  grey?: SharedValue<number>;
  /** The rig's tracks, whose `ends` `Ends` writes as its `side`: web only, and `Ends` is drawn only with them. */
  tracks?: GlossTracks;
  /** The settled felt's second end, laid over this canvas (web only: `feltEndB.tsx`, reached only through `skiaCanvases.ts`, so no native import names it). */
  Ends?: ComponentType<EndsProps>;
  /** The gliding lamp's light pool, laid over this canvas (web only, as `Ends`: `feltPool.tsx`); without it a glide relights the cloth each frame. */
  Pool?: ComponentType<PoolProps>;
}

/** The pool layer's light in design points: its centre, its radius, and its opacity. */
export interface PoolLight {
  x: number;
  y: number;
  r: number;
  o: number;
}

export interface PoolProps {
  light: SharedValue<PoolLight>;
  sx: number;
  sy: number;
  /** The felt's edge in design points, which clips the layer. */
  edge: { x: number; y: number; w: number; h: number; r: number };
}

export interface EndsProps {
  lamp: SharedValue<Lamp>;
  tracks: GlossTracks;
  /** 1 while the canvas still crosses its two ends itself, 0 once it has. */
  settle: SharedValue<number>;
  /** Moves when anything an end draws changes besides the sway. */
  content: SharedValue<number>;
  /** -1 draws end A of a rested lamp and 1 end B; 0 the lamp as it is. */
  side: SharedValue<number>;
  /** The element holding this canvas. */
  host: RefObject<unknown>;
  canvas: RefObject<CanvasRef | null>;
}

const CLOTH = Skia.RuntimeEffect.Make(CLOTH_SKSL);
const WEAVE = Skia.RuntimeEffect.Make(WEAVE_SKSL);
const LIT = Skia.RuntimeEffect.Make(LIT_SKSL);
const REST = Skia.RuntimeEffect.Make(REST_SKSL);
const HAND_LIT = Skia.RuntimeEffect.Make(HAND_LIT_SKSL);
const HAND_CLOTH = Skia.RuntimeEffect.Make(HAND_CLOTH_SKSL);
const NEAREST = { filter: FilterMode.Nearest, mipmap: MipmapMode.None };

// On Android `opaque` swaps the canvas for a SurfaceView; on iOS it needs the Skia patch.
const IOS = Platform.OS === "ios";

function ring(d: number): SkRRect {
  const r = ringRect(d);
  return { rect: { x: r.x, y: r.y, width: r.w, height: r.h }, rx: r.r, ry: r.r };
}

const OUTER = ring(0);
const EDGE = ringRect(RAIL_BAND);
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

/** Each of `frames` drawn in turn on `surface`, at `gx` × `gy` device pixels a design point, and copied off it; `null` where the surface could not be made. */
function bake(surface: SkSurface | null, gx: number, gy: number, frames: ((canvas: SkCanvas) => void)[]): (SkImage | null)[] | null {
  if (!surface) return null;
  const canvas = surface.getCanvas();
  canvas.scale(gx, gy);
  const images = frames.map((frame) => {
    frame(canvas);
    surface.flush();
    const snapshot = surface.makeImageSnapshot();
    // A snapshot is a texture of this surface's context: it dies with the context on web, and on iOS reads black once the surface is disposed below. Copy it to the CPU while the surface is alive.
    const image = snapshot.makeNonTextureImage();
    snapshot.dispose();
    return image;
  });
  surface.dispose();
  return images;
}

// On web an offscreen surface is a WebGL context of its own per bake, read back with a GPU stall.
const offscreen = (gx: number, gy: number) => Skia.Surface.MakeOffscreen(Math.round(DESIGN.width * gx), Math.round(DESIGN.height * gy));

const fill = (shader: SkShader) => (canvas: SkCanvas) => {
  const paint = Skia.Paint();
  paint.setShader(shader);
  canvas.drawRect(Skia.XYWHRect(0, 0, DESIGN.width, DESIGN.height), paint);
  paint.dispose();
};

function bakeRail(k: number): SkImage | null {
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setStyle(PaintStyle.Stroke);
  const rail = (canvas: SkCanvas) =>
    paintRail({
      ring(d, width, colour, dash) {
        const dashes = dash ? Skia.PathEffect.MakeDash(dash.intervals, dash.phase) : null;
        paint.setStrokeWidth(width);
        paint.setColor(Skia.Color(colour));
        paint.setPathEffect(dashes);
        canvas.drawRRect(ring(d), paint);
        dashes?.dispose();
      },
    });
  const [image] = bake(Skia.Surface.Make(Math.round(DESIGN.width * k), Math.round(DESIGN.height * k)), k, k, [rail]) ?? [null];
  paint.dispose();
  return image;
}

/** False only when the readback proves `image` blank at the felt's centre; a build that cannot read pixels back keeps its bake. */
function drewAtCentre(image: SkImage, gx: number, gy: number, drew: (rgba: Uint8Array) => boolean): boolean {
  const x = Math.min(image.width() - 1, Math.round((DESIGN.width / 2) * gx));
  const y = Math.min(image.height() - 1, Math.round((DESIGN.height / 2) * gy));
  const px = image.readPixels(x, y, { width: 1, height: 1, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  return !(px instanceof Uint8Array) || drew(px);
}

const litCloth = (px: Uint8Array) => px[3] > 0 && px[0] + px[1] + px[2] > 24;
const drewCloth = (px: Uint8Array) => px[3] > 0;

/** The weave's planes at `gx` × `gy` device pixels a point, the ones the canvas fills; `null` where no offscreen surface can be made or a plane came out blank. */
function bakeWeave(k: number, gx: number, gy: number): SkImage[] | null {
  if (!WEAVE || !LIT) return null;
  const shaders = Array.from({ length: WEAVE_PLANES }, (_, plane) => WEAVE.makeShader(processUniforms(WEAVE, weaveUniforms(k, plane))));
  const images = bake(offscreen(gx, gy), gx, gy, shaders.map(fill)) ?? [];
  shaders.forEach((shader) => shader.dispose());
  const planes = images.filter((image) => image !== null);
  if (planes.length === WEAVE_PLANES && planes.every((plane) => drewAtCentre(plane, gx, gy, opaquePlane))) return planes;
  planes.forEach((plane) => plane.dispose());
  return null;
}

/** Where the lamp has come to rest, as a key: its glide spent, whatever its sway or flare. `""` while it still moves. */
function settledAim(s: Lamp): string {
  "worklet";
  const near = Math.abs(s.x - s.tx) < SETTLED_PT && Math.abs(s.y - s.ty) < SETTLED_PT && Math.abs(s.r - s.tr) < 0.02;
  return near ? `${s.tx},${s.ty},${s.tr}` : "";
}

const CLOTH_ENDS = [-SWAY, SWAY] as const;
const CACHED_TARGETS = 3;
const CACHED_CLOTHS = CACHED_TARGETS * CLOTH_ENDS.length;

/** The cloth with the lamp `lean` points off its target, unflared, on the canvas's own device pixels. */
function bakeSettled(aim: Pool, base: ClothUniforms, planes: SkImage[] | null, gx: number, gy: number, lean: number): SkImage | null {
  const [tx, ty, reach] = aim;
  return bakeCloth({ ...base, uLamp: [tx + lean, ty - LIGHT_ABOVE], uFlare: 0, ...lightUniforms(reach) }, planes, gx, gy, litCloth);
}

/** Far enough off, and high enough, that the lamp's place shapes no pixel: the cloth's pool, sheen and vignette are all at their far end, and it lights straight down. */
const UNLIT_LAMP = [DESIGN.width / 2, -1e4];
const UNLIT_HEIGHT = 1e6;

/** The cloth with no pool on it, what a glide lays its moving light over (`glideLight.ts`). */
function bakeUnlit(base: ClothUniforms, planes: SkImage[] | null, gx: number, gy: number): SkImage | null {
  return bakeCloth({ ...base, uLamp: UNLIT_LAMP, uLampH: UNLIT_HEIGHT, uFlare: 0, ...lightUniforms(1) }, planes, gx, gy, drewCloth);
}

/** The cloth under `light` on the canvas's own device pixels: lit from the planes, or in one pass where there are none. */
function bakeCloth(light: ClothUniforms, planes: SkImage[] | null, gx: number, gy: number, drew: (rgba: Uint8Array) => boolean): SkImage | null {
  const effect = planes ? LIT : CLOTH;
  if (!effect) return null;
  const uniforms = processUniforms(effect, light);
  const texel = Skia.Matrix();
  texel.scale(1 / gx, 1 / gy);
  const children = (planes ?? []).map((plane) => plane.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Nearest, MipmapMode.None, texel));
  const shader = planes ? effect.makeShaderWithChildren(uniforms, children) : effect.makeShader(uniforms);
  const [image] = bake(offscreen(gx, gy), gx, gy, [fill(shader)]) ?? [null];
  shader.dispose();
  children.forEach((child) => child.dispose());
  texel.dispose();
  if (!image || drewAtCentre(image, gx, gy, drew)) return image;
  image.dispose();
  return null;
}

// CanvasKit frees nothing itself. Skia commits the new image in a layout effect, before an effect's cleanup releases the old.
const free = (image: SkImage) => (DISPOSE_PATHS ? disposeAfterReactions(() => image.dispose()) : image.dispose());

/** The most recently used cloths, so a lamp that returns to a target it has lit already redraws nothing. */
class ClothCache {
  private images = new Map<string, SkImage>();

  get(key: string, bake: () => SkImage | null = () => null): SkImage | null {
    const hit = this.images.get(key) ?? bake();
    this.images.delete(key);
    if (!hit) return null;
    this.images.set(key, hit);
    for (const [oldest, image] of this.images) {
      if (this.images.size <= CACHED_CLOTHS) break;
      this.images.delete(oldest);
      free(image);
    }
    return hit;
  }

  dispose() {
    const all = [...this.images.values()];
    for (const key of [...this.images.keys()]) this.images.delete(key);
    all.forEach(free);
  }
}

/** What the felt bakes for one size of window: the weave, and the cloths lit from it. */
interface Weave {
  planes: SkImage[] | null;
  cloths: ClothCache;
  /** The unlit cloth of the stops it was baked for, outside the cache: every glide draws it. */
  unlit: { stops: string; image: SkImage } | null;
}

const endKey = (aim: string, stops: FeltStops, lean: number) => `${aim}|${stops.join()}|${lean}`;

/** The cloth lit with the lamp `lean` points off the target `aim` names, from the weave's cache or baked into it. */
function endCloth(weave: Weave, aim: string, stops: FeltStops, base: ClothUniforms, gx: number, gy: number, lean: number): SkImage | null {
  const target = aim.split(",").map(Number) as unknown as Pool;
  return weave.cloths.get(endKey(aim, stops, lean), () => bakeSettled(target, base, weave.planes, gx, gy, lean));
}

/** Both ends of the target `aim` names if the cache holds them; a glide bakes nothing. */
function bakedEnds(weave: Weave, aim: string, stops: FeltStops): [SkImage, SkImage] | null {
  const [left, right] = CLOTH_ENDS.map((lean) => weave.cloths.get(endKey(aim, stops, lean)));
  return left && right ? [left, right] : null;
}

function unlitCloth(weave: Weave, stops: FeltStops, base: ClothUniforms, gx: number, gy: number): SkImage | null {
  const key = stops.join();
  if (weave.unlit?.stops === key) return weave.unlit.image;
  const image = bakeUnlit(base, weave.planes, gx, gy);
  if (weave.unlit) free(weave.unlit.image);
  weave.unlit = image && { stops: key, image };
  return image;
}

const freeWeave = ({ planes, cloths, unlit }: Weave) => {
  planes?.forEach(free);
  cloths.dispose();
  if (unlit) free(unlit.image);
};

/** How long a window has to hold one size before the felt bakes for it. A one-off: a debounce on the bake, not a motion the player sees. */
const SIZE_SETTLES_MS = 200;

/**
 * What `make` makes, owned from the commit that adopts it until another replaces it or the felt
 * unmounts. A new `make` is called once its window has held still `SIZE_SETTLES_MS`; until then
 * `held` is the last one's, and `current` false.
 */
function useOwned<T>(make: () => T, drop: (value: T) => void): { held: T | null; current: boolean } {
  const [owned, setOwned] = useState<{ make: () => T; value: T } | null>(null);
  const unadopted = useRef<{ value: T } | null>(null);
  useEffect(() => {
    if (owned?.make === make) return;
    const id = setTimeout(
      () => {
        const value = make();
        unadopted.current = { value };
        setOwned({ make, value });
      },
      owned ? SIZE_SETTLES_MS : 0
    );
    return () => clearTimeout(id);
  }, [make, owned]);
  useEffect(() => {
    if (!owned) return;
    if (unadopted.current?.value === owned.value) unadopted.current = null;
    return () => drop(owned.value);
  }, [owned, drop]);
  // A bake made after the last commit, when the felt unmounts before adopting it.
  useEffect(
    () => () => {
      const left = unadopted.current;
      if (left) drop(left.value);
    },
    [unadopted, drop]
  );
  return { held: owned?.value ?? null, current: owned?.make === make };
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

export function FeltCanvas({ lamp, now, sx, sy, stops, onReady, cards, grey, tracks, Ends: given, Pool: PoolLayer }: FeltCanvasProps) {
  const withEnds = useMemo(() => (tracks && given ? { Ends: given, tracks, Pool: PoolLayer ?? null } : null), [tracks, given, PoolLayer]);
  const greyLayer = useGreyLayer(grey);
  const canvas = useCanvasRef();
  const snapshot = useCallback(() => snapshotPixels(canvas.current), [canvas]);
  useBenchHandle("feltSnapshot", snapshot);
  const [opaque, setOpaque] = useState(IOS);
  const flipOpaque = useCallback((on: boolean) => setOpaque(IOS && on), []);
  useBenchHandle("feltOpaque", flipOpaque);
  const dpr = PixelRatio.get();
  const k = dpr * Math.min(sx, sy);
  useTraceSource("feltK", useCallback(() => k, [k]));
  const gx = dpr * sx;
  const gy = dpr * sy;
  const rail = useMemo(() => bakeRail(k), [k]);
  useEffect(() => () => void (rail && free(rail)), [rail]);
  const makeWeave = useCallback((): Weave => ({ planes: bakeWeave(k, gx, gy), cloths: new ClothCache(), unlit: null }), [k, gx, gy]);
  const owned = useOwned(makeWeave, freeWeave);
  const weave = owned.current ? owned.held : null;
  const planes = weave?.planes ?? null;
  const texel = useMemo(() => [{ scaleX: 1 / gx }, { scaleY: 1 / gy }], [gx, gy]);
  const base = useMemo(() => clothUniforms(stops, k), [stops, k]);

  const [aim, setAim] = useState("");
  const [from, setFrom] = useState("");
  // 1 is the lit cloth, 0 a settled lamp's cross; the reaction lights the felt the frame the lamp moves on, before React drops the cross.
  // A glide drawn from its target's baked cloth arrives already crossed, so it is settled from its first frame there.
  const settle = useSharedValue(1);
  const drawsGlide = useSharedValue(false);
  useAnimatedReaction(
    () => settledAim(lamp.value),
    (now, before) => {
      if (now === before) return;
      settle.set(drawsGlide.value && now ? 0 : 1);
      scheduleOnRN(setAim, now);
      if (!now && before) scheduleOnRN(setFrom, before);
    }
  );
  const [target, setTarget] = useState("");
  const ends = !!withEnds;
  useAnimatedReaction(
    () => (ends ? `${lamp.value.tx},${lamp.value.ty},${lamp.value.tr}` : ""),
    (now, before) => {
      if (now !== before) scheduleOnRN(setTarget, now);
    }
  );
  const rest = useMemo(() => {
    if (!aim || !weave) return null;
    const [left, right] = CLOTH_ENDS.map((lean) => endCloth(weave, aim, stops, base, gx, gy, lean));
    return left && right ? { aim, left, right } : null;
  }, [weave, aim, gx, gy, stops, base]);
  // The ends of the lamp's next target, one a frame while it glides there, so settling bakes nothing.
  const [baked, setBaked] = useState<{ weave: Weave; target: string; stops: FeltStops } | null>(null);
  useEffect(() => {
    if (!withEnds || !weave || !target) return;
    const cancels = CLOTH_ENDS.map((lean, i) =>
      afterFrames(i + 1, () => {
        endCloth(weave, target, stops, base, gx, gy, lean);
        if (i === CLOTH_ENDS.length - 1) setBaked({ weave, target, stops });
      })
    );
    return () => cancels.forEach((cancel) => cancel());
  }, [withEnds, weave, target, gx, gy, stops, base]);
  const poolLayer = !!withEnds?.Pool;
  const [unlitFor, setUnlit] = useState<{ weave: Weave; stops: FeltStops; image: SkImage | null } | null>(null);
  useEffect(() => {
    if (!poolLayer || !weave) return;
    return afterFrames(CLOTH_ENDS.length + 1, () => setUnlit({ weave, stops, image: unlitCloth(weave, stops, base, gx, gy) }));
  }, [poolLayer, weave, stops, base, gx, gy]);
  const unlit = poolLayer && unlitFor?.weave === weave && unlitFor.stops === stops ? unlitFor.image : null;
  const glide = useMemo(() => {
    if (rest || !unlit || !weave || !target) return null;
    const to = baked?.weave === weave && baked.target === target && baked.stops === stops ? bakedEnds(weave, target, stops) : null;
    const back = from && from !== target ? bakedEnds(weave, from, stops) : null;
    const at = (key: string) => key.split(",").map(Number) as unknown as readonly [number, number];
    return { unlit, to, toAt: to ? at(target) : null, from: back, fromAt: back ? at(from) : null };
  }, [rest, unlit, weave, target, from, stops, baked]);
  useLayoutEffect(() => drawsGlide.set(!!glide), [glide, drawsGlide]);
  const reduceMotion = usePrefersReducedMotion();
  useEffect(() => {
    if (!rest) return void settle.set(1);
    const settled = rest.aim;
    const ms = motionMs("shift", reduceMotion);
    scheduleOnUI(() => {
      "worklet";
      if (settledAim(lamp.value) === settled) settle.set(ms ? withTiming(0, { duration: ms, reduceMotion: ReduceMotion.Never }) : 0);
    });
  }, [rest, lamp, settle, reduceMotion]);

  const content = useSharedValue(0);
  const host = useRef<ComponentRef<typeof View>>(null);
  const ownSide = useSharedValue(0);
  const side = tracks?.ends ?? ownSide;
  useLayoutEffect(() => {
    side.set(0);
    return () => side.set(0);
  }, [side]);
  const held = useSharedValue<Shown>(NOT_SHOWN);
  // `lamp.value` subscribes the view to the rig's writes; a held rig writes none, and an end that leaves draws the lamp carried on, not where it was held.
  const view = useDerivedValue(() => {
    const next = nextShown(held.value, lamp.value && now(), side.value);
    if (next !== held.value) held.value = next;
    return next;
  });
  const uniforms = useDerivedValue(() => ({
    ...base,
    uLamp: [view.value.lx, view.value.ly],
    uFlare: view.value.f,
    ...lightUniforms(view.value.r),
  }));
  const lean = useDerivedValue(() => ({ uLean: view.value.lean }));
  const weight = useDerivedValue(() => Math.max(settle.value, flareShare(view.value.f)));
  const draws = useDerivedValue(() => settledDraws(weight.value));
  const cross = useDerivedValue(() => draws.value.cross);
  const hand = useDerivedValue(() => draws.value.hand);
  const handing = useDerivedValue(() => ({ ...uniforms.value, ...lean.value, uW: weight.value }));
  const light = useDerivedValue(() => ({ x: view.value.lx, y: view.value.ly }));
  const soft = useDerivedValue(() => RAIL_LIGHT.soft(view.value.f));
  const coat = useDerivedValue(() => RAIL_LIGHT.coat(view.value.f));
  const shade = useDerivedValue(() => levelShade(view.value.level));
  const toAt = glide?.toAt ?? null;
  const fromAt = glide?.fromAt ?? null;
  const glides = !!glide;
  const gliding = useDerivedValue(() => (glides ? glideCloth(lamp.value && now(), fromAt, toAt) : null), [glides, toAt, fromAt]);
  // A glide's first frame can draw before `gliding` has run for it, and that frame is still the cloth the lamp rested in.
  const fromOpacity = useDerivedValue(() => gliding.value?.from.opacity ?? 1);
  const toOpacity = useDerivedValue(() => gliding.value?.to.opacity ?? 0);
  const fromLean = useDerivedValue(() => ({ uLean: gliding.value?.from.lean ?? view.value.lean }));
  const toLean = useDerivedValue(() => ({ uLean: gliding.value?.to.lean ?? 0.5 }));
  const pool = useDerivedValue<PoolLight>(() => ({
    x: view.value.lx,
    y: view.value.ly,
    r: lightUniforms(view.value.r).uPoolR,
    o: (gliding.value?.pool ?? 0) * Math.min(1, Math.max(0, view.value.level)),
  }));

  const { rects, felt } = cards;
  const shape = useShadowShape(rects);
  const cast = useShadowPicture(CAST, shape, rects, felt, cards.hand.x);
  const contacts = useShadowPicture(CONTACT, shape, rects, felt, cards.hand.x);
  const glow = useGlow(rects, felt, cards.hand.x);
  const pile = { x: cards.pile.x / sx, y: cards.pile.y / sy };
  const fall = useDerivedValue(() => shadowTransform(shadowFall("cast", pile, { x: view.value.lx, y: view.value.ly }), felt));
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

  useAnimatedReaction(
    () => [cast.value, contacts.value, glow.value],
    () => {
      content.value += 1;
    }
  );
  useEffect(() => {
    content.set(content.get() + 1);
  }, [content, rail, rest, shadows, glows, stops, sx, sy, pile.x, pile.y]);

  useEffect(() => {
    if (!onReady) return;
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(onReady);
    });
    return () => cancelAnimationFrame(id);
  }, [onReady]);

  const { width, height } = DESIGN;
  const drawn = (
    <Canvas ref={canvas} opaque={opaque} style={StyleSheet.absoluteFill} testID="felt-skia" pointerEvents="none">
      <Group transform={[{ scaleX: sx }, { scaleY: sy }]} layer={greyLayer}>
        <Rect x={0} y={0} width={width} height={height} color={ROOM} />
        {rail && <Image image={rail} fit="fill" x={0} y={0} width={width} height={height} />}
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
        {rest && REST && (
          <Rect x={0} y={0} width={width} height={height} opacity={cross}>
            <Shader source={REST} uniforms={lean}>
              {[rest.left, rest.right].map((image, i) => (
                <ImageShader key={i} image={image} fit="none" tx="clamp" ty="clamp" sampling={NEAREST} transform={texel} />
              ))}
            </Shader>
          </Rect>
        )}
        {rest && planes && HAND_LIT ? (
          <Rect x={0} y={0} width={width} height={height} opacity={hand}>
            <Shader source={HAND_LIT} uniforms={handing}>
              {[...planes, rest.left, rest.right].map((image, i) => (
                <ImageShader key={i} image={image} fit="none" tx="clamp" ty="clamp" sampling={NEAREST} transform={texel} />
              ))}
            </Shader>
          </Rect>
        ) : rest && HAND_CLOTH ? (
          <Rect x={0} y={0} width={width} height={height} opacity={hand}>
            <Shader source={HAND_CLOTH} uniforms={handing}>
              {[rest.left, rest.right].map((image, i) => (
                <ImageShader key={i} image={image} fit="none" tx="clamp" ty="clamp" sampling={NEAREST} transform={texel} />
              ))}
            </Shader>
          </Rect>
        ) : glide && REST ? (
          <>
            <Rect x={0} y={0} width={width} height={height}>
              <ImageShader image={glide.unlit} fit="none" tx="clamp" ty="clamp" sampling={NEAREST} transform={texel} />
            </Rect>
            {glide.from && (
              <Rect x={0} y={0} width={width} height={height} opacity={fromOpacity}>
                <Shader source={REST} uniforms={fromLean}>
                  {glide.from.map((image, i) => (
                    <ImageShader key={i} image={image} fit="none" tx="clamp" ty="clamp" sampling={NEAREST} transform={texel} />
                  ))}
                </Shader>
              </Rect>
            )}
            {glide.to && (
              <Rect x={0} y={0} width={width} height={height} opacity={toOpacity}>
                <Shader source={REST} uniforms={toLean}>
                  {glide.to.map((image, i) => (
                    <ImageShader key={i} image={image} fit="none" tx="clamp" ty="clamp" sampling={NEAREST} transform={texel} />
                  ))}
                </Shader>
              </Rect>
            )}
          </>
        ) : planes && LIT ? (
          <Rect x={0} y={0} width={width} height={height}>
            <Shader source={LIT} uniforms={uniforms}>
              {planes.map((plane, i) => (
                <ImageShader key={i} image={plane} fit="none" tx="clamp" ty="clamp" sampling={NEAREST} transform={texel} />
              ))}
            </Shader>
          </Rect>
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
  if (!withEnds) return drawn;
  const { Ends, Pool: Light } = withEnds;
  return (
    <>
      <View ref={host} style={StyleSheet.absoluteFill} pointerEvents="none">
        {drawn}
      </View>
      {Light && <Light light={pool} sx={sx} sy={sy} edge={EDGE} />}
      <Ends lamp={lamp} tracks={withEnds.tracks} settle={settle} content={content} side={side} host={host} canvas={canvas} />
    </>
  );
}
