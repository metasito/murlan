// What the fan's gloss at rest is made of, from the rested lamp and the felt's own baked sway (`restEnds.ts`, `lib/swayTable.ts`):
// the streak at either end of the sway, the spot at the centre and its slide, and the fade that crosses the two ends.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import type { CSSAnimationKeyframes } from "react-native-reanimated";
import { cardGloss, glossSpot } from "./cardGloss.ts";
import { SWAY } from "./lampRig.ts";
import { swayKeyframes, type Shown } from "./restEnds.ts";

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

export interface StreakEnd {
  x: number;
  y: number;
  ang: number;
  opacity: number;
}

/** The streak of a back at the two ends of the sway, which the fan's two fades cross between. */
export function streakPose(ends: readonly [Shown, Shown], placed: Placed, box: BackBox): [StreakEnd, StreakEnd] {
  const at = (lamp: Shown): StreakEnd => {
    const g = cardGloss(placed.x, placed.y, box.w, box.h, lamp);
    return { x: g.band.x, y: g.band.y, ang: g.ang, opacity: g.a };
  };
  return [at(ends[0]), at(ends[1])];
}

/** Where the spot stands with the lamp at the centre of its sway, in a back's own axes from its top-left, in design points, and its alpha. */
export function spotPose(centre: Shown, placed: Placed, box: BackBox): { x: number; y: number; alpha: number } {
  const g = glossSpot(placed.x, placed.y, box.w, box.h, centre);
  return { x: g.spot.x, y: g.spot.y, alpha: g.spotAlpha };
}

/** End A's opacity, the fade that end B's (`endTrack`) leaves: they sum to one. */
export const fadeA = (sway: readonly number[]): CSSAnimationKeyframes => swayKeyframes(sway, (v) => ({ opacity: 0.5 - 0.5 * v }));

/**
 * The spot's slide off the centre of the sway, in a back's own axes turned by `rot`: the mockup's one spot moves with the
 * lamp, where a crossfade of two spots 40 points apart would dim its core to under half at mid-sway. `s` the felt's
 * points-to-pixels scale.
 */
export function spotSlide(sway: readonly number[], s: number, rot: number): CSSAnimationKeyframes {
  const t = (rot * Math.PI) / 180;
  return swayKeyframes(sway, (v) => ({ transform: [{ translateX: v * SWAY * s * Math.cos(t) }, { translateY: v * SWAY * s * Math.sin(t) }] }));
}
