import React, { useMemo, useSyncExternalStore } from "react";
import { Platform, StyleSheet, View, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import MaskedViewUntyped from "@react-native-masked-view/masked-view";
import Svg, { Defs, G, LinearGradient, Mask, Rect, Stop } from "react-native-svg";
import { CardGloss } from "@/lib/theme";
import { a11yHidden } from "@/lib/a11y";
import { track as playTrack } from "@/lib/motion";
import { cardRadius } from "@/components/cardFaceModel";
import type { ArcCard } from "@/components/tableArc";
import { backPose, sharedTrack, type Placed, type Played } from "./glossTrack";
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
export function FanGloss({ tracks, s, placed, cards, boxW, boxH, w, h, tilt }: Props) {
  const lamp = useSyncExternalStore(tracks.subscribe, tracks.get);
  const shared = sharedTrack(lamp, s);
  const delay = tracks.delayOf(lamp);
  const poses = useMemo(() => placed.map((p) => backPose(lamp, p, { w: w / s, h: h / s })), [lamp, placed, w, h, s]);
  const mid = Math.floor(cards.length / 2);
  const shapes = useMemo(() => silhouettes(cards, boxW, w, h), [cards, boxW, w, h]);
  const play = (p: Played | null) => (p ? playTrack({ keyframes: p.keyframes as never, duration: p.duration, delay }) : undefined);
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
            <Svg width={boxW} height={boxH} style={styles.overhang}>
              <Defs>
                <LinearGradient id={`streak${end}`} x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={CardGloss.streak.color} stopOpacity={0} />
                  <Stop offset="0.5" stopColor={CardGloss.streak.color} stopOpacity={1} />
                  <Stop offset="1" stopColor={CardGloss.streak.color} stopOpacity={0} />
                </LinearGradient>
                {shapes.map((shape, i) => (
                  <Mask key={i} id={`visible${end}_${i}`} maskUnits="userSpaceOnUse" x={-w} y={-h} width={boxW + 2 * w} height={boxH + 2 * h}>
                    <Rect {...shape.rect} fill="#fff" />
                    {shape.over.map((j) => (
                      <Rect key={j} {...shapes[j]!.rect} fill="#000" />
                    ))}
                  </Mask>
                ))}
              </Defs>
              {shapes.map((shape, i) => {
                const e = poses[i]!.streak[end];
                const diag = Math.hypot(w, h) / s;
                const bandW = 2 * diag * s;
                const bandH = CardGloss.streak.width * diag * s;
                return (
                  <G key={i} mask={`url(#visible${end}_${i})`}>
                    <G transform={`translate(${shape.cx} ${shape.cy}) rotate(${cards[i]!.rot}) translate(${e.x * s} ${e.y * s}) rotate(${(e.ang * 180) / Math.PI})`}>
                      <Rect x={-bandW / 2} y={-bandH / 2} width={bandW} height={bandH} fill={`url(#streak${end})`} opacity={e.opacity} />
                    </G>
                  </G>
                );
              })}
            </Svg>
          </View>
        </Animated.View>
      ))}
      <View pointerEvents="none" style={tilt}>
        <Silhouettes shapes={shapes} boxW={boxW} boxH={boxH} w={w} h={h}>
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
function Silhouettes({ shapes, boxW, boxH, w, h, children }: { shapes: Shape[]; boxW: number; boxH: number; w: number; h: number; children: React.ReactNode }) {
  const outline = (
    <Svg width={boxW} height={boxH} style={styles.overhang}>
      {shapes.map((shape, i) => (
        <Rect key={i} {...shape.rect} fill="#000" />
      ))}
    </Svg>
  );
  if (Platform.OS === "web") {
    const rects = shapes.map((shape) => `<rect x='${shape.rect.x}' y='${shape.rect.y}' width='${w}' height='${h}' rx='${shape.rect.rx}' transform='${shape.rect.transform}'/>`).join("");
    const mask = `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${boxW}' height='${boxH}'>${rects}</svg>`)}")`;
    return <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width: boxW, height: boxH, maskImage: mask, maskSize: "100% 100%", maskRepeat: "no-repeat" } as never}>{children}</View>;
  }
  return (
    <MaskedView style={{ position: "absolute", left: 0, top: 0, width: boxW, height: boxH }} maskElement={outline}>
      {children}
    </MaskedView>
  );
}

const styles = StyleSheet.create({ overhang: { position: "absolute", left: 0, top: 0, overflow: "visible" } });
