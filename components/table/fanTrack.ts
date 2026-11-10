// What every back of a fan shares: the two fades that cross as the lamp sways, as
// keyframes (`FanGloss`). Kept beside `glossTrack.ts`, off the first load with the component that plays it.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import { cardGloss, glossSpot } from "./cardGloss.ts";
import { stepLamp, SWAY, type Lamp } from "./lampRig.ts";
import { GLOSS_HORIZON_S, restLight, type BackBox, type LampPose, type LampSnap, type Placed } from "./glossTrack.ts";
import type { Published } from "./glossTrackStore.ts";

/** Most a linear stretch between two stops may differ from the lamp's own path, in design points. */
const TOLERANCE_PT = 0.4;
/** One level counted as this many points when it sets how finely the stops fall. */
const LEVEL_PT = 40;
export const FRAME = 1 / 60;
const LONGEST_STRETCH = 30;


const seconds = (n: number) => n * FRAME;

const FREE_LAMP: Lamp = {
  x: 0, y: 0, tx: 0, ty: 0, r: 1, tr: 1, ph: 0, kick: 0, flare: 0, lvl: 1, lvlT: 1, lvlRate: 1,
  holds: { lost: 1, breath: 1, link: 1 }, freeze: 0, t: 0, lx: 0, ly: 0, level: 1, f: 0,
  drawn: { lx: 0, ly: 0, level: 1, f: 0, r: 1 },
};

/** The sway's reach from the lamp, in points, at `kick`: the rig's own, read off one of its steps. */
function amplitudeAt(kick: number): number {
  const probe: Lamp = { ...FREE_LAMP, holds: { ...FREE_LAMP.holds }, drawn: { ...FREE_LAMP.drawn }, ph: Math.PI / 2, kick, freeze: 1 };
  stepLamp(probe, 0, false);
  return probe.lx - probe.x;
}
const KICK_AMPLITUDE = amplitudeAt(1) - SWAY;

export const swayAmplitude = (kick: number) => SWAY + KICK_AMPLITUDE * kick;

interface Path {
  frames: number;
  x: Float64Array;
  y: Float64Array;
  r: Float64Array;
  level: Float64Array;
  lx: Float64Array;
  ly: Float64Array;
  kick: Float64Array;
}

/** The rig itself, stepped on a copy at 60 Hz from `snap`: frame `n` is `n / 60` seconds on. */
function simulate(snap: LampSnap, frames: number): Path {
  const s: Lamp = { ...FREE_LAMP, holds: { ...FREE_LAMP.holds }, drawn: { ...FREE_LAMP.drawn }, ...snap };
  s.lx = s.x;
  s.ly = s.y;
  const path: Path = { frames, ...Object.fromEntries(["x", "y", "r", "level", "lx", "ly", "kick"].map((k) => [k, new Float64Array(frames + 1)])) } as Path;
  const record = (n: number) => {
    path.x[n] = s.x;
    path.y[n] = s.y;
    path.r[n] = s.r;
    path.level[n] = s.level;
    path.lx[n] = s.lx;
    path.ly[n] = s.ly;
    path.kick[n] = s.kick;
  };
  stepLamp(s, 0, snap.reduced);
  record(0);
  for (let n = 1; n <= frames; n++) {
    stepLamp(s, FRAME, snap.reduced);
    record(n);
  }
  return path;
}

/** The frames the track stops at: dense where the lamp bends, so a straight line between two stops stays within `TOLERANCE_PT`. */
function stopsOf(path: Path): number[] {
  const bend = (n: number) => {
    const a = Math.max(0, n - 1);
    const b = Math.min(path.frames, n + 1);
    const second = (v: Float64Array, k: number) => Math.abs(v[b]! - 2 * v[n]! + v[a]!) * k;
    return Math.max(second(path.lx, 1), second(path.ly, 1), second(path.level, LEVEL_PT)) / (FRAME * FRAME);
  };
  const stops = [0];
  let n = 0;
  while (n < path.frames) {
    const reach = Math.max(bend(n), bend(Math.min(n + 1, path.frames)));
    const stretch = reach > 0 ? Math.sqrt((8 * TOLERANCE_PT) / reach) / FRAME : LONGEST_STRETCH;
    n = Math.min(path.frames, n + Math.max(1, Math.min(LONGEST_STRETCH, Math.floor(stretch))));
    stops.push(n);
  }
  return stops;
}

/** A lamp track: what every back reads, baked off one snapshot. */
export interface GlossTrack {
  snap: LampSnap;
  /** The `performance.now()` at which the snapshot was taken. */
  epoch: number;
  stops: readonly number[];
  path: Path;
  moves: boolean;
  /** Frames of the horizon. */
  frames: number;
}

const bakes = new WeakMap<object, GlossTrack>();

/** The track baked from a published snapshot, once for the three fans that read it. */
export function trackOf(published: Published): GlossTrack {
  let track = bakes.get(published);
  if (!track) bakes.set(published, (track = bakeGlossTrack(published.snap, published.epoch)));
  return track;
}

export function bakeGlossTrack(snap: LampSnap, epoch: number): GlossTrack {
  const frames = Math.round(GLOSS_HORIZON_S / FRAME);
  const path = simulate(snap, frames);
  const stops = stopsOf(path);
  const still = (v: Float64Array) => v.every((e) => Math.abs(e - v[0]!) < 1e-6);
  const moves = !(still(path.lx) && still(path.ly) && still(path.level));
  return { snap, epoch, stops, path, moves, frames };
}

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

const playOf = (track: GlossTrack, frame: (n: number) => Record<string, unknown>): Played | null => {
  if (!track.moves) return null;
  const last = track.stops.length - 1;
  return { keyframes: keyframesOf(track, last, frame), duration: seconds(track.stops[last]!) * 1000 };
};

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
  const cross = (n: number) => crossAt(p.kick[n]!, p.lx[n]!, p.x[n]!);
  return {
    fadeA: playOf(track, (n) => ({ opacity: 1 - cross(n) })),
    fadeB: playOf(track, (n) => ({ opacity: cross(n) })),
    at: { fadeA: 1 - cross(0), fadeB: cross(0) },
  };
}

/**
 * The spot's slide off where it stands at rest, in a card's own axes turned by `rot`: the lamp's path as the
 * mockup's `gloss()` moves one spot, a translate the compositor plays (a crossfade of two spots 40 points apart
 * would dim its core to under half at mid-sway). `s` the felt's points-to-pixels scale.
 */
export function spotTrack(track: GlossTrack, s: number, rot: number): Played | null {
  const p = track.path;
  const { lx, ly } = restLight(track.snap);
  const t = (rot * Math.PI) / 180;
  return playOf(track, (n) => {
    const dx = (p.lx[n]! - lx) * s;
    const dy = (p.ly[n]! - ly) * s;
    return { transform: [{ translateX: dx * Math.cos(t) - dy * Math.sin(t) }, { translateY: dx * Math.sin(t) + dy * Math.cos(t) }] };
  });
}

export interface StreakEnd {
  x: number;
  y: number;
  ang: number;
  opacity: number;
}

/** The streak at the sway's two extremes where the lamp comes to rest, which the fan's two fades cross between; a glide, a kick or a dim is drawn live (`glossLive`). */
export function streakPose(track: GlossTrack, placed: Placed, box: BackBox): [StreakEnd, StreakEnd] {
  const settled = restLight(track.snap);
  const at = (lamp: LampPose): StreakEnd => {
    const g = cardGloss(placed.x, placed.y, box.w, box.h, lamp);
    return { x: g.band.x, y: g.band.y, ang: g.ang, opacity: g.a };
  };
  return [at({ ...settled, lx: settled.lx - SWAY }), at({ ...settled, lx: settled.lx + SWAY })];
}

/** Where the spot stands at rest in a card's own axes, from its top-left, in design points, and its alpha. */
export function spotPose(track: GlossTrack, placed: Placed, box: BackBox): { x: number; y: number; alpha: number } {
  const g = glossSpot(placed.x, placed.y, box.w, box.h, restLight(track.snap));
  return { x: g.spot.x, y: g.spot.y, alpha: g.spotAlpha };
}

/** The delay, in milliseconds, that starts an animation of a published track where the track is now. */
export const delayOf = (published: Published) => published.epoch - performance.now();
