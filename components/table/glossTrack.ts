// An opponent's back lit by the lamp from a keyframe track baked off the rig's state, so the compositor
// moves it: the Lantern Table mockup's `gloss()` (tests/e2e/fixtures/lantern-table), restored to
// the swaying lamp. The rig stays the one author of the lamp's motion: a bake steps a copy of it.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

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
/** A level this near the baked one is the baked level (`nextGlossBake`). */
const OVER_LEVEL = 1 / 256;
/** The glide, a kick or a level change is over when the lamp is within these of where it ends. */
const OVER_PT = 0.25;
const OVER_REACH = 0.004;
const OVER_KICK = 0.02;
/** Most a linear stretch between two stops may differ from the lamp's own path, in design points. */
const TOLERANCE_PT = 0.4;
/** One level counted as this many points when it sets how finely the stops fall. */
const LEVEL_PT = 40;
export const FRAME = 1 / 60;
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

/** True while the lamp glides, is kicked or dims: the gloss follows it live, as the mockup's `gloss()`, and goes back to the track at the settle. */
export function glossLive(s: Pick<Lamp, "x" | "y" | "tx" | "ty" | "r" | "tr" | "lvl" | "lvlT" | "kick">): boolean {
  "worklet";
  return (
    Math.abs(s.x - s.tx) > OVER_PT ||
    Math.abs(s.y - s.ty) > OVER_PT ||
    Math.abs(s.r - s.tr) > OVER_REACH ||
    Math.abs(s.lvl - s.lvlT) > OVER_LEVEL ||
    s.kick > OVER_KICK
  );
}

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

export function bakeGlossTrack(snap: LampSnap, epoch: number): GlossTrack {
  const frames = Math.round(GLOSS_HORIZON_S / FRAME);
  const path = simulate(snap, frames);
  const stops = stopsOf(path);
  const still = (v: Float64Array) => v.every((e) => Math.abs(e - v[0]!) < 1e-6);
  const moves = !(still(path.lx) && still(path.ly) && still(path.level));
  return { snap, epoch, stops, path, moves, frames };
}

/** The lamp as a gloss reads it. */
type LampPose = Pick<Lamp, "lx" | "ly" | "level" | "r">;

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
  /** The spot at the sway's two extremes, centre from the card's top-left in its own axes, in design points: it crosses on the same fades. */
  spot: [SpotEnd, SpotEnd];
  /** The streak at the sway's two extremes where the lamp comes to rest, which the fan's two fades cross between. */
  streak: [StreakEnd, StreakEnd];
  /** The foil's glint where the lamp comes to rest: it is masked and blended, so no track plays under it. */
  foil: FoilEnd;
  foilEdge: number;
}

export interface SpotEnd {
  x: number;
  y: number;
  alpha: number;
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

const streakAt = (placed: Placed, box: BackBox, lamp: LampPose): StreakEnd => {
  const g = cardGloss(placed.x, placed.y, box.w, box.h, lamp);
  return { x: g.band.x, y: g.band.y, ang: g.ang, opacity: g.a };
};

const foilAt = (placed: Placed, box: BackBox, lamp: LampPose): FoilEnd => {
  const g = foilGlint(placed.x, placed.y, placed.rot, box.w, box.h, lamp);
  return { x: g.band.x, y: g.band.y, ang: g.ang, opacity: (g.peak - g.edge) / (1 - g.edge) };
};

/** Where a back stands in the light the lamp comes to rest in, after a glide, a kick or a level change; the track plays no event on a back. */
export function backPose(track: GlossTrack, placed: Placed, box: BackBox): BackPose {
  const p = track.path;
  const end = p.frames;
  const settled = { lx: p.x[end]!, ly: p.ly[end]!, level: p.level[end]!, r: p.r[end]! };
  const ends = [{ ...settled, lx: settled.lx - SWAY }, { ...settled, lx: settled.lx + SWAY }] as const;
  const spotAt = (lamp: (typeof ends)[number]): SpotEnd => {
    const g = glossSpot(placed.x, placed.y, box.w, box.h, lamp);
    return { x: g.spot.x, y: g.spot.y, alpha: g.spotAlpha };
  };
  return {
    spot: [spotAt(ends[0]), spotAt(ends[1])],
    streak: [streakAt(placed, box, ends[0]), streakAt(placed, box, ends[1])],
    foil: foilAt(placed, box, settled),
    foilEdge: foilGlint(placed.x, placed.y, placed.rot, box.w, box.h, settled).edge,
  };
}
