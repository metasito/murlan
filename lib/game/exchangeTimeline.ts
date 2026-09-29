import { Hold, Motion, Reading } from "../tokens.ts";
import { DEAL_FLIGHT_MS, dealEndMs } from "./dealTimeline.ts";

interface Point { x: number; y: number; rot: number }
interface From extends Point { scale: number }
export interface ExchangePose extends From { visible: boolean; face: boolean; flip: number }
export interface LegPoints { from: From; fromFace: boolean; rest: From; to: From; toFace: boolean }

const X = Motion.exchange;
const REST_REACH = 0.7;
const REST_SCALE = 0.8;
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

export const REST_AT_MS = X.lift + X.fly;
export const REST_END_MS = REST_AT_MS + Hold.reveal;
const LEG_MS = REST_END_MS + X.tuck;
export const RECEIVE_LEAD = X.beat;
export const GIVE_LEAD = X.giveWait;
export const RECEIVE_MS = RECEIVE_LEAD + LEG_MS;
export const GIVE_MS = GIVE_LEAD + LEG_MS;
export const receiveSoundMs = RECEIVE_LEAD;
export const giveSoundMs = GIVE_LEAD;

export function restPoint(to: { x: number; y: number }): From {
  "worklet";
  return { x: to.x * REST_REACH, y: to.y * REST_REACH, rot: 0, scale: REST_SCALE };
}

function legPose(t: number, p: LegPoints): ExchangePose {
  "worklet";
  const { from, rest, to } = p;
  if (t < 0 || t >= LEG_MS) return { ...to, visible: false, face: p.toFace, flip: 1 };
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
  if (t < REST_AT_MS) {
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
  if (t < REST_END_MS) return { ...rest, visible: true, face: true, flip: 1 };
  const k = (t - REST_END_MS) / X.tuck;
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

export function receivePose(t: number, leg: LegPoints): ExchangePose {
  "worklet";
  return legPose(t - RECEIVE_LEAD, leg);
}

export function givePose(t: number, leg: LegPoints): ExchangePose {
  "worklet";
  return legPose(t - GIVE_LEAD, leg);
}

/** The server has no seat geometry, so it deals every seat at the farthest seat's flight: never earlier than the client. */
export function exchangeGiveDelayMs(counts: readonly number[]): number {
  return dealEndMs(counts, Motion.duration.reveal, counts.map(() => DEAL_FLIGHT_MS)) + RECEIVE_MS;
}

export function exchangeAnnounceFrom(bothJokersException: boolean): number {
  return (bothJokersException ? 0 : GIVE_MS) + Reading.notice;
}
