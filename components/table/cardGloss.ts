// A card's lamp gloss: the Lantern Table mockup's `gloss()` (tests/e2e/fixtures/lantern-table), per card.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import { CardGloss } from "../../lib/tokens.ts";
import type { Point } from "./cardRects.ts";
import type { Lamp } from "./lampRig.ts";

export interface Gloss {
  /** The spot's centre from the card's top-left, along the card's own axes, in design points. */
  spot: Point;
  spotAlpha: number;
  /** The streak as the mockup's CSS gradient: angle in radians, peak `cp` and half-width `wp` in percent of the gradient line. */
  ang: number;
  cp: number;
  wp: number;
  a: number;
  /** The streak's peak from the card's centre and its half-width, in design points. */
  band: { x: number; y: number; half: number };
}

/** The lamp as a gloss reads it. */
export type GlossLight = Pick<Lamp, "lx" | "ly" | "level" | "r" | "t">;

/** Steps no soft gloss shows: the lamp sways at the felt's 0.01 pt, and every gloss following that is two mappers a card a frame. */
const GLOSS_POINT_STEP = 0.5;
const GLOSS_LIGHT_STEP = 1 / 256;
/** Under a 60 Hz frame, so its jitter never skips one: a faster display, or jest's 1 ms frames, poses a gloss no oftener. */
export const GLOSS_FRAME_S = 0.012;

export function glossLightOf(lamp: GlossLight): GlossLight {
  "worklet";
  return { lx: lamp.lx, ly: lamp.ly, level: lamp.level, r: lamp.r, t: lamp.t };
}

/** The light every gloss should now read, or null while `lamp` is within a step or a frame of `shown`. */
export function nextGlossLight(shown: GlossLight, lamp: GlossLight): GlossLight | null {
  "worklet";
  if (lamp.t - shown.t < GLOSS_FRAME_S) return null;
  const still =
    Math.abs(lamp.lx - shown.lx) < GLOSS_POINT_STEP &&
    Math.abs(lamp.ly - shown.ly) < GLOSS_POINT_STEP &&
    Math.abs(lamp.level - shown.level) < GLOSS_LIGHT_STEP &&
    Math.abs(lamp.r - shown.r) < GLOSS_LIGHT_STEP;
  return still ? null : glossLightOf(lamp);
}

const clamp01 = (v: number) => {
  "worklet";
  return Math.max(0, Math.min(1, v));
};

/** The spot alone, which needs none of the streak's trigonometry: arguments as `cardGloss`'s. */
export function glossSpot(cx: number, cy: number, w: number, h: number, lamp: Pick<Lamp, "lx" | "ly" | "level">): Pick<Gloss, "spot" | "spotAlpha"> {
  "worklet";
  return { spot: { x: w / 2 + lamp.lx - cx, y: h / 2 + lamp.ly - cy }, spotAlpha: CardGloss.spot.alpha * lamp.level };
}

/** `cx`, `cy` the card's centre and `w`, `h` its own size, all in design points. */
export function cardGloss(cx: number, cy: number, w: number, h: number, lamp: Pick<Lamp, "lx" | "ly" | "level" | "r">): Gloss {
  "worklet";
  const { falloff, squash, streak } = CardGloss;
  const vx = lamp.lx - cx;
  const vy = lamp.ly - cy;
  const d = Math.sqrt(vx * vx + vy * vy) || 1;
  const b = clamp01(1 - Math.sqrt(vx * vx + vy * squash * vy * squash) / (falloff * lamp.r));
  const ang = Math.atan2(vx / d, -vy / d);
  const len = Math.abs(w * Math.sin(ang)) + Math.abs(h * Math.cos(ang));
  const half = Math.sqrt(w * w + h * h) / 2;
  const peak = Math.min(1, d / streak.reach) * streak.travel * half;
  const cp = 50 + (peak / len) * 100;
  const wp = ((half * streak.width) / len) * 100;
  return {
    ...glossSpot(cx, cy, w, h, lamp),
    ang,
    cp,
    wp,
    a: (streak.alpha.floor + streak.alpha.lit * b) * lamp.level,
    band: { x: Math.sin(ang) * peak, y: -Math.cos(ang) * peak, half: half * streak.width },
  };
}
