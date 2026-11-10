// What every back of a fan shares: the two fades that cross as the lamp sways, as
// keyframes (`FanGloss`). Kept beside `glossTrack.ts`, off the first load with the component that plays it.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import { FRAME, swayAmplitude, type GlossTrack } from "./glossTrack.ts";

const seconds = (n: number) => n * FRAME;

type Keyframes = Record<string, Record<string, unknown>>;

function keyframesOf(track: GlossTrack, upTo: number, at: (n: number) => Record<string, unknown>): Keyframes {
  const last = track.stops[upTo]!;
  const out: Keyframes = {};
  for (let i = 0; i <= upTo; i++) {
    const n = track.stops[i]!;
    out[`${+((n / last) * 100).toFixed(4)}%`] = at(n);
  }
  return out;
}

export interface Played {
  keyframes: Keyframes;
  /** Milliseconds. */
  duration: number;
}

/** What every back shares: the two fades that cross as the lamp sways. */
export interface SharedTrack {
  fadeA: Played | null;
  fadeB: Played | null;
  /** The fades as the track begins. */
  at: { fadeA: number; fadeB: number };
}

/** Of the two ends the streak crosses between, the share that the end on the sway's +side holds: 0 at the sway's far side, 1 at the near. */
export const crossAt = (kick: number, lx: number, x: number) => {
  const reach = swayAmplitude(kick);
  return Math.min(1, Math.max(0, (lx - x) / (2 * reach) + 0.5));
};

export function sharedTrack(track: GlossTrack): SharedTrack {
  const p = track.path;
  const last = track.stops.length - 1;
  const cross = (n: number) => crossAt(p.kick[n]!, p.lx[n]!, p.x[n]!);
  const at = { fadeA: 1 - cross(0), fadeB: cross(0) };
  const duration = seconds(track.stops[last]!) * 1000;
  const play = (frame: (n: number) => Record<string, unknown>): Played | null => (track.moves ? { keyframes: keyframesOf(track, last, frame), duration } : null);
  return {
    fadeA: play((n) => ({ opacity: 1 - cross(n) })),
    fadeB: play((n) => ({ opacity: cross(n) })),
    at,
  };
}

