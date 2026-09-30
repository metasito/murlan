// The ring the lamp's legibility sampler reads round a seat, in the felt box's points
// (lib/diagnostics/lampLegibility.ts). JSX-free, runtime imports relative.

import type { Pixels, Ring } from "../../lib/diagnostics/lampLegibility.ts";
import type { FeltStops } from "../../lib/cosmetics.ts";
import { cardScale } from "../cardFaceModel.ts";
import { SEAT_DISC } from "../seatLayout.ts";
import { designScale } from "./lampRig.ts";
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

const linear = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const encoded = (v: number) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (lin: number[]) => 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];

/** The lamp's own stop, dimmed until `ink` reads `NAME_CONTRAST`:1 over it: the brightest felt a seat name may stand on. */
export function nameShade(stops: FeltStops, ink: string): string {
  const floor = (luminance(rgb(ink).map(linear)) + 0.05) / NAME_CONTRAST - 0.05;
  const lit = rgb(stops[0]).map(linear);
  const k = Math.min(1, floor / luminance(lit));
  return `#${lit.map((v) => encoded(v * k).toString(16).padStart(2, "0")).join("")}`;
}
