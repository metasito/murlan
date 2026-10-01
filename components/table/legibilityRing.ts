// The ring the lamp's legibility sampler reads round a seat, in the felt box's points
// (lib/diagnostics/lampLegibility.ts). JSX-free, runtime imports relative.

import type { Pixels, Ring } from "../../lib/diagnostics/lampLegibility.ts";
import type { FeltStops } from "../../lib/cosmetics.ts";
import { cardScale } from "../cardFaceModel.ts";
import { SEAT_DISC } from "../seatLayout.ts";
import type { Point } from "./cardRects.ts";
import { designScale, LAMP_LIGHT, type Lamp } from "./lampRig.ts";
import { RAIL_BAND, ringRect } from "./rail.ts";

/** The research model's outer edge, `zoneMean(…, 17, 45)` in murlan-plans/2026-09-28-1259-lantern-review/scripts/lamp3.mjs. */
export const ANNULUS_OUTER = 45;

/** Starts at the drawn disc's edge (`SEAT_DISC * cardScale`, as `anchorPoints` draws it); reaches 45 design pt of the stretched table. */
export function legibilityRing(width: number, height: number): Ring {
  const { sx, sy } = designScale(width, height);
  return {
    inner: (SEAT_DISC * cardScale(Math.min(width, height))) / 2,
    outerX: ANNULUS_OUTER * sx,
    outerY: ANNULUS_OUTER * sy,
  };
}

/** The felt box's pixels with everything outside the cloth, the rail and the room, made transparent: the sampler counts only felt. */
export function feltOnly(pixels: Pixels, perPt: number): Pixels {
  const { width, height } = pixels;
  const { sx, sy } = designScale(width / perPt, height / perPt);
  const { x, y, w, h, r } = ringRect(RAIL_BAND);
  const data = Uint8ClampedArray.from(pixels.data);
  for (let j = 0; j < height; j++) {
    const py = (j + 0.5) / perPt / sy;
    const dy = Math.max(y + r - py, 0, py - (y + h - r));
    for (let i = 0; i < width; i++) {
      const px = (i + 0.5) / perPt / sx;
      const dx = Math.max(x + r - px, 0, px - (x + w - r));
      if (dx * dx + dy * dy > r * r) data[(j * width + i) * 4 + 3] = 0;
    }
  }
  return { width, height, data };
}

/** WCAG's body floor is 4.5; the margin covers the weave's brightest thread. */
export const NAME_CONTRAST = 5;

/** Relative luminance of an encoded sRGB colour, channels 0–1. */
export function luminance(c: readonly number[]): number {
  "worklet";
  const lin = c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** `#rrggbb` or `rgba(r,g,b,a)`, channels 0–1, as the browser composites it over `under`: in encoded sRGB. */
export function inkOver(ink: string, under: number[]): number[] {
  const rgba = /^rgba\(([^)]*)\)$/.exec(ink)?.[1].split(",").map(Number);
  if (!rgba) return rgb(ink);
  return under.map((u, i) => (rgba[i] / 255) * rgba[3] + u * (1 - rgba[3]));
}

export function contrast(a: number[], b: number[]): number {
  const [la, lb] = [a, b].map((c) => luminance(c) + 0.05);
  return Math.max(la, lb) / Math.min(la, lb);
}

/** The most light, as relative luminance, the felt under a name in `ink` may give: the lamp's own stop dimmed until the ink reads `NAME_CONTRAST`:1. */
export function nameCeiling(stops: FeltStops, ink: string): number {
  const top = rgb(stops[0]);
  const under = (v: number) => top.map((c) => (c * v) / 255);
  let v = 255;
  while (v > 0 && contrast(inkOver(ink, under(v)), under(v)) < NAME_CONTRAST) v--;
  return luminance(under(v));
}

/** feltShader.ts's `cloth` at `p` before the weave: its albedo, the lamp's glow and the vignette, encoded 0–1. */
export function feltLight(stops: readonly number[][], lamp: Pick<Lamp, "lx" | "ly" | "r" | "f">, p: Point): number[] {
  "worklet";
  const d = Math.hypot(p.x - lamp.lx, (p.y - lamp.ly) * 1.15);
  const t = Math.min(1, d / (LAMP_LIGHT.poolR * lamp.r + lamp.f * 120));
  const i = Math.min(3, Math.floor(t * 4));
  const glow = (1 - t) ** 2 * (0.14 + 0.35 * lamp.f);
  const vigR = LAMP_LIGHT.vigR * lamp.r;
  const e = Math.min(1, Math.max(0, (Math.hypot(p.x - lamp.lx, p.y - lamp.ly) - (vigR * 16) / 54) / (vigR - (vigR * 16) / 54)));
  const vig = 1 - 0.72 * e * e * (3 - 2 * e);
  return [0, 1, 2].map((c) => Math.min(1, (stops[i][c] + (stops[i + 1][c] - stops[i][c]) * (t * 4 - i) + [1, 0.78, 0.45][c] * glow) * vig));
}

/**
 * The grey whose multiply brings `light` down to `ceiling`, white where it is dark enough already. A
 * multiply and not a darken: a darken clamps the cloth flat, weave and all.
 */
export function nameDim(light: readonly number[], ceiling: number): number {
  "worklet";
  if (luminance(light) <= ceiling) return 1;
  let [lo, hi] = [0, 1];
  for (let n = 0; n < 12; n++) {
    const g = (lo + hi) / 2;
    if (luminance(light.map((c) => c * g)) <= ceiling) lo = g;
    else hi = g;
  }
  return lo;
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
