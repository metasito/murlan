// The ring the lamp's legibility sampler reads round a seat, in the felt box's points
// (lib/diagnostics/lampLegibility.ts). JSX-free, runtime imports relative.

import type { Pixels, Ring } from "../../lib/diagnostics/lampLegibility.ts";
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
