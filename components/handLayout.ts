// Pure layout math for StraightHand's card row (components/table/hand.tsx).
//
// Keep this file free of JSX and of any import from a .tsx file: Node's TS
// loader type-strips plain .ts only, and `node --test` is what covers it.

import { CARD_W } from "./cardFaceModel.ts";

export { CARD_W };

// WCAG 2.2 SC 2.5.8 Level AA: 24x24 CSS px, or the undersized-target
// exception, which needs 24px circles on adjacent targets not to intersect.
// Adjacent card centres are exactly `step` apart, so below 24 fails both.
// 44pt needs ~630px of hand width at 14 cards — tests/e2e/tapTargets.spec.ts
// names the hand as its one deliberate exception.

/** Smallest overlap step (px) that keeps a card its own tappable target. */
export const MIN_READABLE_STEP = 24;

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
 * The overlap step shrinks as `n` grows or `availW` shrinks, down to
 * `MIN_READABLE_STEP`. Below that it holds and reports `scrollable`, so a big
 * hand on a narrow device overflows rather than losing a card to a clip.
 */
export function computeHandLayout(n: number, availW: number): HandLayout {
  if (n <= 1) {
    return { step: 0, totalW: CARD_W, scrollable: false };
  }
  const idealStep = (availW - CARD_W) / (n - 1);
  if (idealStep >= MIN_READABLE_STEP) {
    const step = Math.min(CARD_W, idealStep);
    return { step, totalW: step * (n - 1) + CARD_W, scrollable: false };
  }
  const step = MIN_READABLE_STEP;
  return { step, totalW: step * (n - 1) + CARD_W, scrollable: true };
}
