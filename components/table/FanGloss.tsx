import React, { useEffect, useMemo, useSyncExternalStore } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import { SvgXml } from "react-native-svg";
import { CardGloss } from "@/lib/theme";
import { a11yHidden } from "@/lib/a11y";
import { ambient } from "@/lib/motion";
import { cardRadius } from "@/components/cardFaceModel";
import type { ArcCard } from "@/components/tableArc";
import { bandBox } from "./cardGloss";
import { backPose, type BackPose, type Placed } from "./glossTrack";
import { sharedTrack, type Played } from "./fanTrack";
import type { GlossTracks } from "./glossTrackStore";

interface Props {
  tracks: GlossTracks;
  /** The felt's points-to-pixels scale. */
  s: number;
  placed: readonly Placed[];
  cards: readonly ArcCard[];
  /** The fan's box and the size of one back, in pixels. */
  boxW: number;
  boxH: number;
  w: number;
  h: number;
  /** The fan's tilt, which the gloss shares so that it lies on the backs. */
  tilt: ViewStyle;
  /** Told once the gloss is drawn, and again when it goes: the backs draw their own while it is not. */
  onCover: (covered: boolean) => void;
}

/**
 * The lamp's gloss over one opponent's fan at rest, drawn once for the fan instead of once per back: a back with
 * a running animation of its own is a layer of its own under the fan's tilt, and each such layer is resampled
 * soft. Spot and streak are two static pictures of the fan, one per extreme of the sway, whose opacities cross
 * on one shared track. Every pixel of the gloss is linear in these, so it is the per-back crossfade of the
 * mockup's `gloss()`, each back in its own frame and occluded by the backs over it. A glide, a kick or a dim is
 * drawn by the backs themselves (`GlossTracks.live`), and the fan's gloss is hidden meanwhile.
 */
export const FanGloss = React.memo(function FanGloss({ tracks, s, placed, cards, boxW, boxH, w, h, tilt, onCover }: Props) {
  const lamp = useSyncExternalStore(tracks.subscribe, tracks.get);
  const live = useSyncExternalStore(tracks.subscribe, tracks.live);
  const baked = useMemo(() => {
    const shared = sharedTrack(lamp);
    const delay = tracks.delayOf(lamp);
    const play = (p: Played | null) => (p ? ambient({ keyframes: p.keyframes as never, duration: p.duration, delay }) : undefined);
    return { fades: [shared.fadeA, shared.fadeB].map(play), at: [shared.at.fadeA, shared.at.fadeB] };
  }, [lamp, tracks]);
  const poses = useMemo(() => placed.map((p) => backPose(lamp, p, { w: w / s, h: h / s })), [lamp, placed, w, h, s]);
  const shapes = useMemo(() => silhouettes(cards, boxW, w, h), [cards, boxW, w, h]);
  const pictures = useMemo(() => [0, 1].map((end) => gossXml(end, shapes, cards, poses, s, w, h, boxW, boxH)), [shapes, cards, poses, s, w, h, boxW, boxH]);

  useEffect(() => {
    onCover(true);
    return () => onCover(false);
  }, [onCover]);

  return (
    <View testID="card-gloss" pointerEvents="none" style={live ? styles.hidden : StyleSheet.absoluteFill} {...a11yHidden()}>
      {pictures.map((xml, end) => (
        <Animated.View key={end} pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: baked.at[end] }, baked.fades[end]]}>
          <View pointerEvents="none" style={tilt}>
            <SvgXml xml={xml} width={boxW + 2 * w} height={boxH + 2 * w} style={{ position: "absolute", left: -w, top: -w }} />
          </View>
        </Animated.View>
      ))}
    </View>
  );
});

interface Shape {
  cx: number;
  cy: number;
  rect: { x: number; y: number; width: number; height: number; rx: number; transform: string };
  /** The backs painted over this one, which hide what is drawn on it. */
  over: number[];
}

function silhouettes(cards: readonly ArcCard[], boxW: number, w: number, h: number): Shape[] {
  const reach = Math.hypot(w, h);
  const rx = cardRadius(w);
  const shapes = cards.map((c) => {
    const x = boxW / 2 + c.x;
    const cx = x + w / 2;
    const cy = c.y + h / 2;
    return { cx, cy, rect: { x, y: c.y, width: w, height: h, rx, transform: `rotate(${c.rot} ${cx} ${cy})` }, over: [] as number[] };
  });
  shapes.forEach((a, i) => {
    for (let j = i + 1; j < shapes.length; j++) if (Math.hypot(shapes[j]!.cx - a.cx, shapes[j]!.cy - a.cy) < reach) a.over.push(j);
  });
  return shapes;
}

const rect = (r: Shape["rect"], fill: string) => `<rect x='${r.x}' y='${r.y}' width='${r.width}' height='${r.height}' rx='${r.rx}' transform='${r.transform}' fill='${fill}'/>`;

/** One end's gloss as a single picture: each back's spot and streak, in the back's own frame, masked by the backs painted over it. As XML, so that a rebake redraws one picture per end and no per-back element. */
function gossXml(end: number, shapes: Shape[], cards: readonly ArcCard[], poses: readonly BackPose[], s: number, w: number, h: number, boxW: number, boxH: number): string {
  const { streak, spot } = CardGloss;
  const band = bandBox(w, h, streak.width);
  const radius = spot.radius * s;
  const masks = shapes
    .map((shape, i) => `<mask id='v${end}_${i}' maskUnits='userSpaceOnUse' x='${-w}' y='${-h}' width='${boxW + 2 * w}' height='${boxH + 2 * h}'>${rect(shape.rect, "#fff")}${shape.over.map((j) => rect(shapes[j]!.rect, "#000")).join("")}</mask>`)
    .join("");
  const lit = shapes
    .map((shape, i) => {
      const e = poses[i]!.streak[end];
      const p = poses[i]!.spot[end];
      const frame = `translate(${shape.cx} ${shape.cy}) rotate(${cards[i]!.rot})`;
      const spotAt = `translate(${p.x * s - w / 2} ${p.y * s - h / 2})`;
      const band_ = `translate(${e.x * s} ${e.y * s}) rotate(${(e.ang * 180) / Math.PI})`;
      // One child under each mask: a masked group with two is a render surface per back, 140 passes a frame.
      const masked = (inner: string) => `<g mask='url(#v${end}_${i})'><g transform='${frame}'>${inner}</g></g>`;
      return (
        masked(`<circle r='${radius}' transform='${spotAt}' fill='url(#s${end})' opacity='${p.alpha}'/>`) +
        masked(`<g transform='${band_}'><rect x='${-band.w / 2}' y='${-band.h / 2}' width='${band.w}' height='${band.h}' fill='url(#g${end})' opacity='${e.opacity}'/></g>`)
      );
    })
    .join("");
  const stops = (color: string, ...at: [number, number][]) => at.map(([o, a]) => `<stop offset='${o}' stop-color='${color}' stop-opacity='${a}'/>`).join("");
  const gradient = `<linearGradient id='g${end}' x1='0' y1='0' x2='0' y2='1'>${stops(streak.color, [0, 0], [0.5, 1], [1, 0])}</linearGradient>`;
  const blob = `<radialGradient id='s${end}'><stop offset='0' stop-color='${spot.color}' stop-opacity='1'/><stop offset='${spot.mid.at}' stop-color='${spot.mid.color}' stop-opacity='${spot.mid.alpha / spot.alpha}'/><stop offset='1' stop-color='${spot.mid.color}' stop-opacity='0'/></radialGradient>`;
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${boxW + 2 * w}' height='${boxH + 2 * w}' viewBox='${-w} ${-w} ${boxW + 2 * w} ${boxH + 2 * w}'><defs>${gradient}${blob}${masks}</defs>${lit}</svg>`;
}

const styles = StyleSheet.create({ hidden: { display: "none" } });
