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

const clamp01 = (v: number) => {
  "worklet";
  return Math.max(0, Math.min(1, v));
};

/** `cx`, `cy` the card's centre and `w`, `h` its own size, all in design points. */
export function cardGloss(cx: number, cy: number, w: number, h: number, lamp: Pick<Lamp, "lx" | "ly" | "level" | "r">): Gloss {
  "worklet";
  const { falloff, squash, spot, streak } = CardGloss;
  const vx = lamp.lx - cx;
  const vy = lamp.ly - cy;
  const d = Math.hypot(vx, vy) || 1;
  const b = clamp01(1 - Math.hypot(vx, vy * squash) / (falloff * lamp.r));
  const ang = Math.atan2(vx / d, -vy / d);
  const len = Math.abs(w * Math.sin(ang)) + Math.abs(h * Math.cos(ang));
  const half = Math.hypot(w, h) / 2;
  const peak = Math.min(1, d / streak.reach) * streak.travel * half;
  const cp = 50 + (peak / len) * 100;
  const wp = ((half * streak.width) / len) * 100;
  return {
    spot: { x: w / 2 + vx, y: h / 2 + vy },
    spotAlpha: spot.alpha * lamp.level,
    ang,
    cp,
    wp,
    a: (streak.alpha.floor + streak.alpha.lit * b) * lamp.level,
    band: { x: Math.sin(ang) * peak, y: -Math.cos(ang) * peak, half: half * streak.width },
  };
}
