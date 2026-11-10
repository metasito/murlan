import React, { useMemo, useSyncExternalStore } from "react";
import { Platform, StyleSheet, View, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import MaskedViewUntyped from "@react-native-masked-view/masked-view";
import { SvgXml } from "react-native-svg";
import { CardGloss } from "@/lib/theme";
import { a11yHidden } from "@/lib/a11y";
import { ambient } from "@/lib/motion";
import { cardRadius } from "@/components/cardFaceModel";
import type { ArcCard } from "@/components/tableArc";
import { backPose, type BackPose, type Placed } from "./glossTrack";
import { sharedTrack, type Played } from "./fanTrack";
import type { GlossTracks } from "./glossTrackStore";
import { GLOSS_SPOT_ART } from "./LampGloss";

// 0.3.2's types extend React Native's `NativeMethods`, which the Strict TypeScript API no longer exports.
const MaskedView = MaskedViewUntyped as unknown as React.ComponentType<{ style: ViewStyle; maskElement: React.ReactElement; children: React.ReactNode }>;

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
}

/**
 * The lamp's gloss over one opponent's fan, drawn once for the fan instead of once per back: a back with a
 * running animation of its own is a layer of its own under the fan's tilt, and each such layer is resampled
 * soft. The streak is two static pictures of the fan, one per extreme of the sway, whose opacities cross on
 * one shared track; the spot is one blob under a static mask of the backs' silhouettes. Every pixel of the
 * gloss is linear in these, so it is the per-back crossfade of the mockup's `gloss()`, occlusion included.
 */
export const FanGloss = React.memo(function FanGloss({ tracks, s, placed, cards, boxW, boxH, w, h, tilt }: Props) {
  const lamp = useSyncExternalStore(tracks.subscribe, tracks.get);
  const shared = useMemo(() => sharedTrack(lamp, s), [lamp, s]);
  const delay = tracks.delayOf(lamp);
  const poses = useMemo(() => placed.map((p) => backPose(lamp, p, { w: w / s, h: h / s })), [lamp, placed, w, h, s]);
  const mid = Math.floor(cards.length / 2);
  const shapes = useMemo(() => silhouettes(cards, boxW, w, h), [cards, boxW, w, h]);
  const play = (p: Played | null) => (p ? ambient({ keyframes: p.keyframes as never, duration: p.duration, delay }) : undefined);
  const fades = [shared.fadeA, shared.fadeB] as const;
  const fadeAt = [shared.at.fadeA, shared.at.fadeB] as const;

  const spot = poses[mid]!.spot;
  const at = cards[mid]!;
  const t = (at.rot * Math.PI) / 180;
  const dx = spot.x * s - w / 2;
  const dy = spot.y * s - h / 2;
  const spotX = boxW / 2 + at.x + w / 2 + dx * Math.cos(t) - dy * Math.sin(t);
  const spotY = at.y + h / 2 + dx * Math.sin(t) + dy * Math.cos(t);
  const radius = CardGloss.spot.radius * s;

  return (
    <View testID="card-gloss" pointerEvents="none" style={StyleSheet.absoluteFill} {...a11yHidden()}>
      {fades.map((fade, end) => (
        <Animated.View key={end} pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: fadeAt[end] }, play(fade)]}>
          <View pointerEvents="none" style={tilt}>
            <SvgXml xml={streakXml(end, shapes, cards, poses, s, w, h, boxW, boxH)} width={boxW} height={boxH} style={styles.overhang} />
          </View>
        </Animated.View>
      ))}
      <View pointerEvents="none" style={tilt}>
        <Silhouettes shapes={shapes} boxW={boxW} boxH={boxH}>
          <View pointerEvents="none" style={{ position: "absolute", left: spotX, top: spotY, width: 0, height: 0 }}>
            <Animated.Image
              testID="card-gloss-spot"
              source={GLOSS_SPOT_ART()}
              resizeMode="stretch"
              style={[{ position: "absolute", left: -radius, top: -radius, width: 2 * radius, height: 2 * radius, opacity: poses[mid]!.spotAlpha }, play(shared.spot) as never]}
            />
          </View>
        </Silhouettes>
      </View>
    </View>
  );
}, sameGloss);

/** One end's streaks as a single picture, each back's band masked by the backs painted over it. As XML, so that a rebake redraws one picture and no per-back element. */
const rect = (r: Shape["rect"], fill: string) => `<rect x='${r.x}' y='${r.y}' width='${r.width}' height='${r.height}' rx='${r.rx}' transform='${r.transform}' fill='${fill}'/>`;
const svgOf = (boxW: number, boxH: number, inner: string) => `<svg xmlns='http://www.w3.org/2000/svg' width='${boxW}' height='${boxH}' overflow='visible'>${inner}</svg>`;

function streakXml(end: number, shapes: Shape[], cards: readonly ArcCard[], poses: readonly BackPose[], s: number, w: number, h: number, boxW: number, boxH: number): string {
  const { color, width } = CardGloss.streak;
  const diag = Math.hypot(w, h);
  const bandW = 2 * diag;
  const bandH = width * diag;
  const masks = shapes
    .map((shape, i) => `<mask id='v${end}_${i}' maskUnits='userSpaceOnUse' x='${-w}' y='${-h}' width='${boxW + 2 * w}' height='${boxH + 2 * h}'>${rect(shape.rect, "#fff")}${shape.over.map((j) => rect(shapes[j]!.rect, "#000")).join("")}</mask>`)
    .join("");
  const bands = shapes
    .map((shape, i) => {
      const e = poses[i]!.streak[end];
      const place = `translate(${shape.cx} ${shape.cy}) rotate(${cards[i]!.rot}) translate(${e.x * s} ${e.y * s}) rotate(${(e.ang * 180) / Math.PI})`;
      return `<g mask='url(#v${end}_${i})'><g transform='${place}'><rect x='${-bandW / 2}' y='${-bandH / 2}' width='${bandW}' height='${bandH}' fill='url(#g${end})' opacity='${e.opacity}'/></g></g>`;
    })
    .join("");
  const gradient = `<linearGradient id='g${end}' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${color}' stop-opacity='0'/><stop offset='0.5' stop-color='${color}' stop-opacity='1'/><stop offset='1' stop-color='${color}' stop-opacity='0'/></linearGradient>`;
  return svgOf(boxW, boxH, `<defs>${gradient}${masks}</defs>${bands}`);
}

/** The fan lays its places out afresh on every render, so equal places are told by value: a bot's move that leaves this fan alone then redraws none of its gloss. */
function sameGloss(a: Props, b: Props): boolean {
  return (Object.keys(a) as (keyof Props)[]).every((k) => a[k] === b[k] || (typeof a[k] === "object" && JSON.stringify(a[k]) === JSON.stringify(b[k])));
}

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

/** `children` shown through the backs' silhouettes alone, as one static mask over everything that moves inside it. */
function Silhouettes({ shapes, boxW, boxH, children }: { shapes: Shape[]; boxW: number; boxH: number; children: React.ReactNode }) {
  const outline = svgOf(boxW, boxH, shapes.map((shape) => rect(shape.rect, "#000")).join(""));
  const box = { position: "absolute", left: 0, top: 0, width: boxW, height: boxH } as const;
  if (Platform.OS === "web") {
    const mask = `url("data:image/svg+xml;utf8,${encodeURIComponent(outline)}")`;
    return <View pointerEvents="none" style={{ ...box, maskImage: mask, maskSize: "100% 100%", maskRepeat: "no-repeat" } as never}>{children}</View>;
  }
  return (
    <MaskedView style={box} maskElement={<SvgXml xml={outline} width={boxW} height={boxH} style={styles.overhang} />}>
      {children}
    </MaskedView>
  );
}

const styles = StyleSheet.create({ overhang: { position: "absolute", left: 0, top: 0, overflow: "visible" } });