// An opponent's back lit by the lamp from a keyframe track baked off the rig's state, so the compositor
// moves it: the Lantern Table mockup's `gloss()` (tests/e2e/fixtures/lantern-table), restored to
// the swaying lamp. The rig stays the one author of the lamp's motion: a bake steps a copy of it.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import { foilGlint } from "./cardGloss.ts";
import { LIGHT_ABOVE, type Lamp } from "./lampRig.ts";

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

/** The lamp as a gloss reads it. */
export type LampPose = Pick<Lamp, "lx" | "ly" | "level" | "r">;

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

/** The foil's glint where the lamp comes to rest: it is masked and blended, so no track plays under it. */
export interface FoilEnd {
  x: number;
  y: number;
  ang: number;
  opacity: number;
}

/** The lamp where a glide, a kick or a level change leaves it, which the gloss at rest is posed in. */
export function settledLamp(snap: LampSnap): LampPose {
  return { lx: snap.tx, ly: snap.ty - LIGHT_ABOVE, level: snap.lvlT, r: snap.tr };
}

export function foilPose(snap: LampSnap, placed: Placed, box: BackBox): { foil: FoilEnd; foilEdge: number } {
  const g = foilGlint(placed.x, placed.y, placed.rot, box.w, box.h, settledLamp(snap));
  return { foil: { x: g.band.x, y: g.band.y, ang: g.ang, opacity: (g.peak - g.edge) / (1 - g.edge) }, foilEdge: g.edge };
}
