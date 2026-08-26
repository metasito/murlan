// The home screen's drifting card field: the depth bands, the cards placed in
// them, and the geometry that keeps them card-shaped.
//
// JSX-free and relatively imported for the same reason gameTableModel.ts is —
// Node's own loader runs the tests over it.
//
// A fixed table rather than values drawn per mount. The field is decoration,
// but a composition that differs every time the screen opens is one no
// reviewer and no test ever sees twice (#397).
import { CARD_H, CARD_W } from "./cardFaceModel.ts";

/** The reference implementation quotes travel in `em`, against a 16px root. */
const EM = 16;

export type Depth = "far" | "mid" | "near";

export interface DepthBand {
  /** Card size, as a scale of the 64x90 face in `cardFaceModel.ts`. */
  scale: number;
  opacity: number;
  /** Vertical travel, one rest-to-peak leg. */
  rise: number;
  /** Horizontal travel at full tilt, which is where the sway peaks with it. */
  sway: number;
  /** Peak tilt either side of upright, in degrees. */
  tilt: number;
  /** One rise and fall. */
  driftMs: number;
  /** One tilt, right to left and back. */
  tiltMs: number;
  /** Fed to `makeShadow` at the call site, which needs `Platform`. */
  shadow: { offsetY: number; opacity: number; radius: number; elevation: number };
}

/**
 * Depth read from one channel does not convince, so every channel carries it:
 * a nearer card is larger, denser, travels further, turns further, moves
 * faster and casts a deeper shadow than the one behind it.
 *
 * No two periods here divide into each other, within a band or across them,
 * which is what stops the field returning to a pose the eye can recognise.
 */
export const DEPTH_BANDS: Record<Depth, DepthBand> = {
  far: {
    scale: 0.6,
    opacity: 0.13,
    rise: 0.9 * EM,
    sway: 0.18 * EM,
    tilt: 4.5,
    driftMs: 15_000,
    tiltMs: 19_000,
    shadow: { offsetY: 2, opacity: 0.18, radius: 6, elevation: 2 },
  },
  mid: {
    scale: 0.75,
    opacity: 0.2,
    rise: 1.5 * EM,
    sway: 0.34 * EM,
    tilt: 6.5,
    driftMs: 11_000,
    tiltMs: 14_000,
    shadow: { offsetY: 4, opacity: 0.26, radius: 10, elevation: 4 },
  },
  near: {
    scale: 0.95,
    opacity: 0.3,
    rise: 2.4 * EM,
    sway: 0.55 * EM,
    tilt: 9,
    driftMs: 8_000,
    tiltMs: 10_000,
    shadow: { offsetY: 7, opacity: 0.34, radius: 16, elevation: 7 },
  },
};

export interface FloatingCardSpec {
  depth: Depth;
  /** Left edge, as a fraction of the screen's width — a fixed pixel column
   * that fits a 390pt phone puts the last card off a narrower one. */
  x: number;
  /** How far through its first leg the card already is, so the field is in
   * motion on first paint instead of leaving rest together. */
  driftPhase: number;
  tiltPhase: number;
}

/** Spread across the bands and across the width. */
export const PORTRAIT_CARDS: FloatingCardSpec[] = [
  { depth: "near", x: 0.04, driftPhase: 0.12, tiltPhase: 0.55 },
  { depth: "far", x: 0.21, driftPhase: 0.68, tiltPhase: 0.21 },
  { depth: "mid", x: 0.39, driftPhase: 0.35, tiltPhase: 0.87 },
  { depth: "near", x: 0.56, driftPhase: 0.81, tiltPhase: 0.06 },
  { depth: "far", x: 0.71, driftPhase: 0.47, tiltPhase: 0.63 },
  { depth: "mid", x: 0.84, driftPhase: 0.93, tiltPhase: 0.38 },
];

/** Four, and all of them in the left column the wordmark stands in — the
 * landscape menu owns the rest of the width. */
export const LANDSCAPE_CARDS: FloatingCardSpec[] = [
  { depth: "mid", x: 0.02, driftPhase: 0.28, tiltPhase: 0.71 },
  { depth: "far", x: 0.08, driftPhase: 0.74, tiltPhase: 0.15 },
  { depth: "near", x: 0.14, driftPhase: 0.05, tiltPhase: 0.49 },
  { depth: "far", x: 0.2, driftPhase: 0.59, tiltPhase: 0.92 },
];

/** A band's card, at the face's own proportions rather than a ratio by eye. */
export function cardBox(depth: Depth): { width: number; height: number } {
  const { scale } = DEPTH_BANDS[depth];
  return { width: CARD_W(scale), height: CARD_H(scale) };
}

/**
 * Where a card stands at its own phase — along its rise from 0 to 1, and
 * across its swing from -1 to 1. It enters its loop here, and it is where
 * reduced motion parks it: off upright, so a stilled field still reads as
 * scattered rather than as a grid.
 */
export function restingPose(spec: FloatingCardSpec): { rise: number; swing: number } {
  return { rise: spec.driftPhase, swing: spec.tiltPhase * 2 - 1 };
}
