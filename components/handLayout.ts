// Pure layout math for StraightHand's card row (components/table/hand.tsx).
//
// Keep this file free of JSX and of any import from a .tsx file: Node's TS
// loader type-strips plain .ts only, and `node --test` is what covers it.
import { HAND_ARC } from "./tableArc.ts";

// WCAG 2.2 SC 2.5.8 Level AA: 24x24 CSS px, or the undersized-target
// exception, which needs 24px circles on adjacent targets not to intersect.
// Adjacent card centres are exactly `step` apart, so below 24 fails both.
// 44pt needs ~630px of hand width at 14 cards — tests/e2e/tapTargets.spec.ts
// names the hand as its one deliberate exception. #193 asks for 34, which is
// the prototype's own step: 24 is the correction to it, not a shortfall to
// raise back.

/** Smallest overlap step (px) that keeps a card its own tappable target. */
export const MIN_READABLE_STEP = 24;

/**
 * The widest a hand ever steps, as a share of a card: past it the cards stop
 * overlapping enough to read as one held hand. It is the arc's own ratio,
 * taken from the arc rather than restated — the step and the curve it is laid
 * on have to agree about how wide the hand is.
 */
export const MAX_STEP_RATIO = HAND_ARC.stepRatio;

export interface HandLayout {
  /** Horizontal distance (px) between each card's left edge. */
  step: number;
  /** Total width (px) spanned by the row: left edge of card 0 to the right edge of the last card. */
  totalW: number;
  /**
   * True when `totalW` exceeds `availW`. The caller must let the row overflow
   * inside a scrollable container rather than clip it or shrink `step`.
   */
  scrollable: boolean;
}

/**
 * The hand fills `room` and then compresses inside it: more cards overlap
 * further, they do not reach wider. That is the whole shape of the thing — a
 * hand of five is not a hand of twenty-one spread thin, and a full hand does
 * not push the seats off the edge of the felt.
 *
 * Two bounds, both on the step rather than on the span. `MAX_STEP_RATIO` stops
 * a short hand from fanning out into a row of separate cards, and
 * `MIN_READABLE_STEP` is the finger: below it two adjacent cards cannot be
 * told apart by touch, whatever the arc would prefer. `cardW` is the caller's
 * own already-scaled hand card width; `availW` is the hard edge past which the
 * caller must scroll rather than clip.
 */
export function computeHandLayout(
  n: number,
  room: number,
  cardW: number,
  availW: number = room
): HandLayout {
  if (n <= 1) {
    return { step: 0, totalW: cardW, scrollable: false };
  }
  const ideal = (room - cardW) / (n - 1);
  const step = Math.min(Math.max(ideal, MIN_READABLE_STEP), cardW * MAX_STEP_RATIO);
  const totalW = step * (n - 1) + cardW;
  return { step, totalW, scrollable: totalW > availW };
}
