// An opponent's back lit by the lamp from a keyframe track baked off the rig's state, so the compositor
// moves it: the Lantern Table mockup's `gloss()` (tests/e2e/fixtures/lantern-table), restored to
// the swaying lamp. The rig stays the one author of the lamp's motion: a bake steps a copy of it.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import { CardGloss } from "../../lib/tokens.ts";
import { cardGloss, foilGlint, glossSpot } from "./cardGloss.ts";
import { SWAY, stepLamp, type Lamp } from "./lampRig.ts";

/** What a track is baked from: the rig's state at an instant. */
export type LampSnap = Pick<Lamp, "x" | "y" | "tx" | "ty" | "r" | "tr" | "ph" | "kick" | "lvl" | "lvlT" | "lvlRate" | "freeze" | "t"> & { reduced: boolean };

export function snapOf(s: Lamp, reduced: boolean): LampSnap {
  "worklet";
  return { x: s.x, y: s.y, tx: s.tx, ty: s.ty, r: s.r, tr: s.tr, ph: s.ph, kick: s.kick, lvl: s.lvl, lvlT: s.lvlT, lvlRate: s.lvlRate, freeze: s.freeze, t: s.t, reduced };
}

/** Seconds a track runs. The aperiodic sway is baked this far and rebaked before it ends. */
export const GLOSS_HORIZON_S = 300;
const REBAKE_BEFORE_S = 10;
/** The glide, a kick or a level change is over when it is within these of where it ends. */
const OVER_PT = 0.25;
const OVER_LEVEL = 1 / 256;
const OVER_REACH = 0.004;
const EVENT_CAP_S = 12;
/** Most a linear stretch between two stops may differ from the lamp's own path, in design points. */
const TOLERANCE_PT = 0.4;
/** One level counted as this many points when it sets how finely the stops fall. */
const LEVEL_PT = 40;
const FRAME = 1 / 60;
const LONGEST_STRETCH = 30;

/** The next snapshot to bake from, or null while `baked` still describes the lamp. */
export function nextGlossBake(baked: LampSnap | null, lamp: Lamp, reduced: boolean): LampSnap | null {
  "worklet";
  if (!baked) return snapOf(lamp, reduced);
  const elapsed = lamp.t - baked.t;
  const lvl = baked.lvlT + (baked.lvl - baked.lvlT) * Math.exp(-baked.lvlRate * elapsed);
  const changed =
    lamp.tx !== baked.tx ||
    lamp.ty !== baked.ty ||
    lamp.tr !== baked.tr ||
    lamp.lvlT !== baked.lvlT ||
    lamp.lvlRate !== baked.lvlRate ||
    lamp.freeze !== baked.freeze ||
    reduced !== baked.reduced ||
    lamp.kick > baked.kick ||
    Math.abs(lamp.lvl - lvl) > OVER_LEVEL ||
    elapsed > GLOSS_HORIZON_S - REBAKE_BEFORE_S;
  return changed ? snapOf(lamp, reduced) : null;
}

interface Path {
  frames: number;
  x: Float64Array;
  y: Float64Array;
  r: Float64Array;
  level: Float64Array;
  lx: Float64Array;
  ly: Float64Array;
  ph: Float64Array;
  kick: Float64Array;
}

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

/** The rig itself, stepped on a copy at 60 Hz from `snap`: frame `n` is `n / 60` seconds on. */
function simulate(snap: LampSnap, frames: number): Path {
  const s: Lamp = { ...FREE_LAMP, holds: { ...FREE_LAMP.holds }, drawn: { ...FREE_LAMP.drawn }, ...snap };
  s.lx = s.x;
  s.ly = s.y;
  const path: Path = { frames, ...Object.fromEntries(["x", "y", "r", "level", "lx", "ly", "ph", "kick"].map((k) => [k, new Float64Array(frames + 1)])) } as Path;
  const record = (n: number) => {
    path.x[n] = s.x;
    path.y[n] = s.y;
    path.r[n] = s.r;
    path.level[n] = s.level;
    path.lx[n] = s.lx;
    path.ly[n] = s.ly;
    path.ph[n] = s.ph;
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

function eventFrames(path: Path, snap: LampSnap): number {
  const cap = Math.min(path.frames, Math.round(EVENT_CAP_S / FRAME));
  let last = 0;
  for (let n = 0; n <= cap; n++) {
    const moving =
      Math.abs(path.x[n]! - snap.tx) > OVER_PT ||
      Math.abs(path.y[n]! - snap.ty) > OVER_PT ||
      Math.abs(swayAmplitude(path.kick[n]!) - SWAY) > OVER_PT ||
      Math.abs(path.level[n]! - snap.lvlT) > OVER_LEVEL ||
      Math.abs(path.r[n]! - snap.tr) > OVER_REACH;
    if (moving) last = n + 1;
  }
  return last;
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
  /** Stops up to the first that is past the glide, a kick and a level change; the backs' own tracks run this long. */
  eventStops: number;
  path: Path;
  moves: boolean;
  /** Frames of the horizon. */
  frames: number;
}

export function bakeGlossTrack(snap: LampSnap, epoch: number): GlossTrack {
  const frames = Math.round(GLOSS_HORIZON_S / FRAME);
  const path = simulate(snap, frames);
  const stops = stopsOf(path);
  const eventAt = eventFrames(path, snap);
  const eventStops = eventAt === 0 ? 0 : stops.findIndex((n) => n >= eventAt) + 1 || stops.length;
  const still = (v: Float64Array) => v.every((e) => Math.abs(e - v[0]!) < 1e-6);
  const moves = !(still(path.lx) && still(path.ly) && still(path.level));
  return { snap, epoch, stops, eventStops, path, moves, frames };
}

/** The lamp at stop `i`, in the light a gloss reads. */
function lampAt(track: GlossTrack, n: number) {
  const p = track.path;
  return { lx: p.lx[n]!, ly: p.ly[n]!, level: p.level[n]!, r: p.r[n]! };
}

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

/** What every back shares: the spot's move off where it stands now, and the two fades that cross as the lamp sways. */
export interface SharedTrack {
  spot: Played | null;
  fadeA: Played | null;
  fadeB: Played | null;
  /** The fades as the track begins. */
  at: { fadeA: number; fadeB: number };
  played: boolean;
}

/** Of the two ends the streak crosses between, the share that the end on the sway's +side holds: 0 at the sway's far side, 1 at the near. */
export const crossAt = (kick: number, lx: number, x: number) => {
  const reach = swayAmplitude(kick);
  return Math.min(1, Math.max(0, (lx - x) / (2 * reach) + 0.5));
};

const sharedCache = new WeakMap<GlossTrack, Map<number, SharedTrack>>();

/** `s` the felt's points-to-pixels scale. */
export function sharedTrack(track: GlossTrack, s: number): SharedTrack {
  let bySize = sharedCache.get(track);
  if (!bySize) sharedCache.set(track, (bySize = new Map()));
  const known = bySize.get(s);
  if (known) return known;
  const p = track.path;
  const last = track.stops.length - 1;
  const cross = (n: number) => crossAt(p.kick[n]!, p.lx[n]!, p.x[n]!);
  const at = { fadeA: 1 - cross(0), fadeB: cross(0) };
  const duration = seconds(track.stops[last]!) * 1000;
  const play = (frame: (n: number) => Record<string, unknown>): Played | null => (track.moves ? { keyframes: keyframesOf(track, last, frame), duration } : null);
  const made: SharedTrack = {
    spot: play((n) => ({
      transform: [{ translateX: (p.lx[n]! - p.lx[0]!) * s }, { translateY: (p.ly[n]! - p.ly[0]!) * s }],
      opacity: CardGloss.spot.alpha * p.level[n]!,
    })),
    fadeA: play((n) => ({ opacity: 1 - cross(n) })),
    fadeB: play((n) => ({ opacity: cross(n) })),
    at,
    played: track.moves,
  };
  bySize.set(s, made);
  return made;
}

/** The place and size of a back as the table lays it out: its centre in design points, its own box and turn. */
export interface Placed {
  x: number;
  y: number;
  rot: number;
}

/** A back's size in design points. */
export interface BackBox {
  w: number;
  h: number;
}

export interface BackPose {
  /** The spot's centre from the card's top-left, in design points, as the track begins. */
  spot: { x: number; y: number };
  spotAlpha: number;
  /** The streak at the sway's two extremes where the lamp comes to rest, which the fan's two fades cross between. */
  streak: [StreakEnd, StreakEnd];
  /** The foil's glint where the lamp comes to rest: it is masked and blended, so no track plays under it. */
  foil: FoilEnd;
  foilEdge: number;
}

export interface StreakEnd {
  x: number;
  y: number;
  ang: number;
  opacity: number;
}

export interface FoilEnd {
  x: number;
  y: number;
  ang: number;
  opacity: number;
}

const streakAt = (placed: Placed, box: BackBox, lamp: ReturnType<typeof lampAt>): StreakEnd => {
  const g = cardGloss(placed.x, placed.y, box.w, box.h, lamp);
  return { x: g.band.x, y: g.band.y, ang: g.ang, opacity: g.a };
};

const foilAt = (placed: Placed, box: BackBox, lamp: ReturnType<typeof lampAt>): FoilEnd => {
  const g = foilGlint(placed.x, placed.y, placed.rot, box.w, box.h, lamp);
  return { x: g.band.x, y: g.band.y, ang: g.ang, opacity: (g.peak - g.edge) / (1 - g.edge) };
};

/** The lamp one end of a crossfade stands for at stop `n`: the sway's far or near extreme about where the lamp points. */
function endsAt(track: GlossTrack, n: number): [ReturnType<typeof lampAt>, ReturnType<typeof lampAt>] {
  const p = track.path;
  const reach = swayAmplitude(p.kick[n]!);
  const here = lampAt(track, n);
  return [
    { ...here, lx: p.x[n]! - reach },
    { ...here, lx: p.x[n]! + reach },
  ];
}

/** Where a back stands in the light the lamp comes to rest in, after a glide, a kick or a level change; the track plays no event on a back. */
export function backPose(track: GlossTrack, placed: Placed, box: BackBox): BackPose {
  const lamp0 = lampAt(track, 0);
  const spot = glossSpot(placed.x, placed.y, box.w, box.h, lamp0);
  const rest = track.stops[Math.min(track.eventStops, track.stops.length - 1)]!;
  const settled = { ...lampAt(track, rest), lx: track.path.x[rest]! };
  const [a, b] = endsAt(track, rest);
  return {
    spot: spot.spot,
    spotAlpha: spot.spotAlpha,
    streak: [streakAt(placed, box, a), streakAt(placed, box, b)],
    foil: foilAt(placed, box, settled),
    foilEdge: foilGlint(placed.x, placed.y, placed.rot, box.w, box.h, settled).edge,
  };
}
