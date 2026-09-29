// The ring the lamp's legibility sampler reads round a seat, in the felt box's points
// (lib/diagnostics/lampLegibility.ts). JSX-free, runtime imports relative.

import type { Ring } from "../../lib/diagnostics/lampLegibility.ts";
import { cardScale } from "../cardFaceModel.ts";
import { SEAT_DISC } from "../seatLayout.ts";
import { designScale } from "./lampRig.ts";

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
