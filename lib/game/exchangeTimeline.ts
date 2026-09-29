import { Hold, Motion } from "../tokens.ts";
import { DEAL_FLIGHT_MS, dealEndMs } from "./dealTimeline.ts";

interface Point { x: number; y: number; rot: number }
interface From extends Point { scale: number }
export interface ExchangePose extends From { visible: boolean; face: boolean; flip: number }
export interface LegPoints { from: From; fromFace: boolean; rest: From; to: From; toFace: boolean }
/** Where a leg is, from its first visible frame (`flying`) to its landing. */
export type LegStage = "waiting" | "flying" | "rest" | "tuck" | "landed";
/** Offsets from a leg's first visible frame: at rest on the pile, leaving it, landed. */
export interface LegTimes { rest: number; tuck: number; end: number }

const X = Motion.exchange;
const ARC = 30;
const clamp01 = (k: number) => {
  "worklet";
  return Math.min(1, Math.max(0, k));
};
const ease = (k: number) => {
  "worklet";
  return 1 - Math.pow(1 - clamp01(k), 3);
};
const lerp = (a: number, b: number, e: number) => {
  "worklet";
  return a + (b - a) * e;
};
const turn = (k: number) => {
  "worklet";
  return Math.max(0.02, Math.abs(Math.cos(Math.PI * clamp01(k))));
};

export const LEG: LegTimes = { rest: X.lift + X.fly, tuck: X.lift + X.fly + Hold.reveal, end: X.lift + X.fly + Hold.reveal + X.tuck };
/** Reduced motion keeps the rest, which is reading, and drops the travel either side of it. */
export const REDUCED_LEG: LegTimes = { rest: 0, tuck: Hold.reveal, end: Hold.reveal };
/** From the deal's end to the receive landing, and from the choice to the give landing. */
export const RECEIVE_MS = X.beat + LEG.end;
export const GIVE_MS = X.giveWait + LEG.end;

export function legTimes(reduced: boolean): LegTimes {
  "worklet";
  return reduced ? REDUCED_LEG : LEG;
}

/** The pile's centre, where a traded card rests face up at a played card's size; `dx` lays the two Jokers side by side. */
export function restPoint(dx = 0): From {
  "worklet";
  return { x: dx, y: 0, rot: dx / 9, scale: 1 };
}

export function legStage(t: number, times: LegTimes): LegStage {
  "worklet";
  if (t < 0) return "waiting";
  if (t < times.rest) return "flying";
  if (t < times.tuck) return "rest";
  if (t < times.end) return "tuck";
  return "landed";
}

/** The card `t` ms after its leg's first visible frame (tests/e2e/fixtures/exchange-legs, `legRun`). */
export function legPose(t: number, p: LegPoints, reduced = false): ExchangePose {
  "worklet";
  const times = legTimes(reduced);
  if (t < 0) return { ...p.from, visible: false, face: p.fromFace, flip: 1 };
  if (t >= times.end) return { ...p.to, visible: false, face: p.toFace, flip: 1 };
  const { from, rest, to } = p;
  if (t >= times.rest && t < times.tuck) return { ...rest, visible: true, face: true, flip: 1 };
  if (t < X.lift) {
    const k = t / X.lift;
    return {
      ...from,
      scale: lerp(from.scale, rest.scale, ease(k)),
      visible: true,
      face: p.fromFace || k >= 0.5,
      flip: p.fromFace ? 1 : turn(k),
    };
  }
  if (t < times.rest) {
    const e = ease((t - X.lift) / X.fly);
    return {
      x: lerp(from.x, rest.x, e),
      y: lerp(from.y, rest.y, e) - ARC * Math.sin(Math.PI * e),
      rot: lerp(from.rot, rest.rot, e),
      scale: rest.scale,
      visible: true,
      face: true,
      flip: 1,
    };
  }
  const k = (t - times.tuck) / X.tuck;
  const e = ease(k);
  return {
    x: lerp(rest.x, to.x, e),
    y: lerp(rest.y, to.y, e),
    rot: lerp(rest.rot, to.rot, e),
    scale: lerp(rest.scale, to.scale, e),
    visible: true,
    face: p.toFace || k < 0.5,
    flip: p.toFace ? 1 : turn(k),
  };
}

/** When the choice opens, on the trade's clock: the receive landed and read. */
export function choiceOpensAt(reduced: boolean): number {
  "worklet";
  return X.beat + legTimes(reduced).end + X.read;
}

/** When the receive and the give first show, on the trade's clock; `choice` is when the choice was seen, null before it. */
export function legShows(choice: number | null, reduced: boolean): [number, number] {
  "worklet";
  return [X.beat, choice === null ? Infinity : Math.max(choice + X.giveWait, choiceOpensAt(reduced))];
}

/** When the ceremony closes: its last leg landed and read. */
export function ceremonyEndsAt(shows: readonly number[], reduced: boolean, jokers: boolean): number {
  "worklet";
  return shows[jokers ? 0 : 1] + legTimes(reduced).end + X.read;
}

/** The server has no seat geometry, so it deals every seat at the farthest seat's flight: never earlier than the client. */
export function exchangeGiveDelayMs(counts: readonly number[]): number {
  return dealEndMs(counts, Motion.duration.reveal, counts.map(() => DEAL_FLIGHT_MS)) + RECEIVE_MS + X.read;
}

/** From the choice to the ceremony's close; for both Jokers, from the deal's end. */
export function exchangeAnnounceFrom(bothJokersException: boolean): number {
  return (bothJokersException ? X.beat : X.giveWait) + LEG.end + X.read;
}
