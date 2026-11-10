import React, { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import { SvgXml } from "react-native-svg";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { CardGloss } from "@/lib/theme";
import { a11yHidden } from "@/lib/a11y";
import { afterFrames, ambient, ambientPlace, steerAmbient } from "@/lib/motion";
import { CARD_BACK_H, CARD_BACK_W, cardRadius } from "@/components/cardFaceModel";
import type { ArcCard } from "@/components/tableArc";
import { bandBox } from "./cardGloss";
import { designRect, TABLE_AT_REST, type DrawnCard, type Felt } from "./cardRects";
import { fadeA, spotPose, spotSlide, streakPose, type Placed, type StreakEnd } from "./fanTrack";
import { SPOT_STOPS, STREAK_STOPS } from "./glossStops";
import type { GlossTracks } from "./glossTrackStore";
import { SWAY } from "./lampRig";
import { DRIFT_CHECK_MS, endLamp, endTrack, placeOf, steering, type Shown } from "./restEnds";

interface Props {
  tracks: GlossTracks;
  /** The felt, and the backs as drawn: where each stands in design points is what the gloss is posed from. */
  felt: Felt;
  drawn: readonly DrawnCard[];
  cards: readonly ArcCard[];
  /** The fan's box, and the scale of its backs. */
  box: { w: number; h: number };
  backScale: number;
  /** The fan's tilt, which the gloss shares so that it lies on the backs. */
  tilt: ViewStyle;
  /** Told when the gloss is drawn and still, and when it is not (it is gone, or the lamp moves): the backs draw their own then. */
  onCover: (covered: boolean) => void;
}

/**
 * The lamp's gloss over one opponent's fan at rest, drawn once for the fan instead of once per back: a back with
 * a running animation of its own is a layer of its own under the fan's tilt, and each such layer is resampled
 * soft. The streak is two static pictures of the fan, one per extreme of the sway, whose opacities cross on one
 * shared track, each back in its own frame and occluded by the backs over it; the spot is one blob that slides on
 * a translate track under a static mask of the backs' silhouettes. A glide, a kick or a dim is drawn by the backs
 * themselves (`GlossTracks.live`): the fan's gloss is made transparent meanwhile, never stopped, so its tracks
 * stay where the rig's lamp is when it returns.
 */
export const FanGloss = React.memo(function FanGloss({ tracks, felt, drawn, cards, box, backScale, tilt, onCover }: Props) {
  const s = felt.s;
  const placed = useMemo(() => drawn.map((card) => designRect(card, felt, TABLE_AT_REST)), [drawn, felt]);
  const { w: boxW, h: boxH } = box;
  const w = CARD_BACK_W(backScale);
  const h = CARD_BACK_H(backScale);
  const epoch = useSyncExternalStore(tracks.subscribe, tracks.get);
  const live = useSyncExternalStore(tracks.subscribe, tracks.live);
  const reduceMotion = usePrefersReducedMotion();
  // Baked where the lamp rests, as the felt's end B is: the settle moves `epoch`, and so does a track that has run out.
  const baked = useMemo(() => {
    const s = tracks.lamp.get();
    return { epoch, track: endTrack(s.ph, s.t), ends: [endLamp(s, -SWAY), endLamp(s, SWAY)] as const, centre: endLamp(s, 0) };
  }, [tracks, epoch]);
  const { track } = baked;
  const shapes = useMemo(() => silhouettes(cards, boxW, w, h), [cards, boxW, w, h]);
  const streaks = useMemo(() => placed.map((p) => streakPose(baked.ends, p, { w: w / s, h: h / s })), [baked, placed, w, h, s]);
  const pictures = useMemo(() => [0, 1].map((end) => streakXml(end, shapes, cards, streaks, s, w, h, boxW, boxH)), [shapes, cards, streaks, s, w, h, boxW, boxH]);
  const spot = useMemo(() => spotOf(baked.centre, placed, cards, shapes, s, w, h), [baked, placed, cards, shapes, s, w, h]);
  const motion = useMemo(
    () => (reduceMotion ? [] : [fadeA(track.sway), track.keyframes, spotSlide(track.sway, s, spot.rot)].map((keyframes) => ambient({ keyframes, duration: track.duration }))),
    [reduceMotion, track, s, spot.rot]
  );
  // Motionless, the lamp is at the centre: the ends cross half and half and the spot stands.
  const lean = reduceMotion ? 0.5 : 0.5 + 0.5 * track.sway[0]!;
  const [fadeANode, fadeBNode, spotNode] = [useRef<NodeRef>(null), useRef<NodeRef>(null), useRef<NodeRef>(null)];

  useLayoutEffect(() => {
    onCover(!live);
    return () => onCover(false);
  }, [live, onCover]);

  useLayoutEffect(() => {
    if (reduceMotion) return;
    const elements = () => [fadeANode, fadeBNode, spotNode].map((n) => n.current as unknown as Element | null).filter((e): e is Element => !!e);
    const steer = (to: { place: number } | { paused: boolean }) => elements().forEach((e) => steerAmbient(e, to));
    const place = () => ({ place: placeOf(track, tracks.lamp.get().t) });
    // The animation starts when the commit does, not when the track was baked: it is moved to where the rig is the frame it exists.
    let left = START_WAIT_FRAMES;
    let cancel = () => {};
    const start = () => {
      const first = elements()[0];
      if (first && ambientPlace(first) !== null) return steer(place());
      if (--left > 0) cancel = afterFrames(1, start);
    };
    cancel = afterFrames(2, start);
    // The rig steps at most `MAX_DT` a frame, so a page that stalls runs it behind the clock the animation keeps: hold them together.
    const check = setInterval(() => {
      const first = elements()[0];
      if (!first || tracks.live()) return;
      const next = steering(track, ambientPlace(first), tracks.lamp.get().t);
      if (next.kind === "rebake") tracks.rebake();
      else if (next.kind === "steer") steer({ place: next.place });
    }, DRIFT_CHECK_MS);
    // A hidden page steps no rig while its animation keeps the clock: hold it, and put it where the rig is on return.
    const visibility = () => {
      if (document.hidden) steer({ paused: true });
      else {
        steer(place());
        steer({ paused: false });
      }
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancel();
      clearInterval(check);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [reduceMotion, track, tracks, fadeANode, fadeBNode, spotNode]);

  const radius = CardGloss.spot.radius * s;
  return (
    <View testID="card-gloss" pointerEvents="none" style={[StyleSheet.absoluteFill, live && styles.live]} {...a11yHidden()}>
      {pictures.map((xml, end) => (
        <Animated.View key={end} ref={end ? fadeBNode : fadeANode} pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: end ? lean : 1 - lean }, motion[end]]}>
          <View pointerEvents="none" style={tilt}>
            <SvgXml xml={xml} width={boxW + 2 * w} height={boxH + 2 * w} style={{ position: "absolute", left: -w, top: -w }} />
          </View>
        </Animated.View>
      ))}
      <View pointerEvents="none" style={tilt}>
        <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width: boxW, height: boxH, ...maskOf(shapes, boxW, boxH) }}>
          <Animated.View ref={spotNode} pointerEvents="none" style={[{ position: "absolute", left: spot.x - radius, top: spot.y - radius, width: 2 * radius, height: 2 * radius, opacity: spot.alpha }, motion[2]]}>
            <SvgXml xml={blobXml()} width={2 * radius} height={2 * radius} />
          </Animated.View>
        </View>
      </View>
    </View>
  );
}, sameGloss);

/** The fan lays its places out afresh on every render, so equal places are told by value: a bot's move that leaves this fan alone then redraws none of its gloss. */
function sameGloss(a: Props, b: Props): boolean {
  return (Object.keys(a) as (keyof Props)[]).every((k) => a[k] === b[k] || (typeof a[k] === "object" && JSON.stringify(a[k]) === JSON.stringify(b[k])));
}

type NodeRef = React.ComponentRef<typeof Animated.View>;

/** Frames a mounted track may take to start before it is left where the rig put it. */
const START_WAIT_FRAMES = 30;

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
const stops = (list: typeof SPOT_STOPS | typeof STREAK_STOPS) => list.map((s) => `<stop offset='${s.at}' stop-color='${s.color}' stop-opacity='${s.alpha}'/>`).join("");

/** The back nearest the lamp where it rests: the spot's slide is posed in its frame, which is the frame the mockup lights it in. */
function spotOf(centre: Shown, placed: readonly Placed[], cards: readonly ArcCard[], shapes: Shape[], s: number, w: number, h: number) {
  const near = placed.reduce((best, p, i) => (Math.hypot(p.x - centre.lx, p.y - centre.ly) < Math.hypot(placed[best]!.x - centre.lx, placed[best]!.y - centre.ly) ? i : best), 0);
  const pose = spotPose(centre, placed[near]!, { w: w / s, h: h / s });
  const rot = cards[near]!.rot;
  const t = (rot * Math.PI) / 180;
  const dx = pose.x * s - w / 2;
  const dy = pose.y * s - h / 2;
  return { x: shapes[near]!.cx + dx * Math.cos(t) - dy * Math.sin(t), y: shapes[near]!.cy + dx * Math.sin(t) + dy * Math.cos(t), alpha: pose.alpha, rot };
}

const blobXml = () => `<svg xmlns='http://www.w3.org/2000/svg' viewBox='-1 -1 2 2'><defs><radialGradient id='s' cx='0' cy='0' r='1' gradientUnits='userSpaceOnUse'>${stops(SPOT_STOPS)}</radialGradient></defs><circle r='1' fill='url(#s)'/></svg>`;

/** The backs' silhouettes as a static CSS mask: the one clip that follows them, and that leaves the spot free to slide beneath it. */
function maskOf(shapes: Shape[], boxW: number, boxH: number): ViewStyle {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${boxW}' height='${boxH}'>${shapes.map((shape) => rect(shape.rect, "#000")).join("")}</svg>`;
  return { maskImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`, maskSize: "100% 100%", maskRepeat: "no-repeat" } as ViewStyle;
}

/** One end's streaks as a single picture: each back's band, in the back's own frame, masked by the backs painted over it. As XML, so that a rebake redraws one picture per end and no per-back element. */
function streakXml(end: number, shapes: Shape[], cards: readonly ArcCard[], poses: readonly (readonly [StreakEnd, StreakEnd])[], s: number, w: number, h: number, boxW: number, boxH: number): string {
  const band = bandBox(w, h, CardGloss.streak.width);
  const masks = shapes
    .map((shape, i) => `<mask id='v${end}_${i}' maskUnits='userSpaceOnUse' x='${-w}' y='${-h}' width='${boxW + 2 * w}' height='${boxH + 2 * h}'>${rect(shape.rect, "#fff")}${shape.over.map((j) => rect(shapes[j]!.rect, "#000")).join("")}</mask>`)
    .join("");
  const bands = shapes
    .map((shape, i) => {
      const e = poses[i]![end];
      const place = `translate(${shape.cx} ${shape.cy}) rotate(${cards[i]!.rot}) translate(${e.x * s} ${e.y * s}) rotate(${(e.ang * 180) / Math.PI})`;
      return `<g mask='url(#v${end}_${i})'><g transform='${place}'><rect x='${-band.w / 2}' y='${-band.h / 2}' width='${band.w}' height='${band.h}' fill='url(#g${end})' opacity='${e.opacity}'/></g></g>`;
    })
    .join("");
  const gradient = `<linearGradient id='g${end}' x1='0' y1='0' x2='0' y2='1'>${stops(STREAK_STOPS)}</linearGradient>`;
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${boxW + 2 * w}' height='${boxH + 2 * w}' viewBox='${-w} ${-w} ${boxW + 2 * w} ${boxH + 2 * w}'><defs>${gradient}${masks}</defs>${bands}</svg>`;
}

const styles = StyleSheet.create({ live: { opacity: 0 } });
