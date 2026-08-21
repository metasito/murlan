// Pure layout math for StraightHand's card row (components/table/hand.tsx).
//
// Keep this file free of JSX and of any import from a .tsx file: Node's TS
// loader type-strips plain .ts only, and `node --test` is what covers it.

// WCAG 2.2 SC 2.5.8 Level AA: 24x24 CSS px, or the undersized-target
// exception, which needs 24px circles on adjacent targets not to intersect.
// Adjacent card centres are exactly `step` apart, so below 24 fails both.
// 44pt needs ~630px of hand width at 14 cards — tests/e2e/tapTargets.spec.ts
// names the hand as its one deliberate exception.

/** Smallest overlap step (px) that keeps a card its own tappable target. */
export const MIN_READABLE_STEP = 24;

/**
 * A card's own hit-test centre sits `cardW / 2` from its left edge; the next
 * card (drawn after it, so stacked on top in the overlap — hand.tsx gives
 * CardItem a rising `zIndex={i}`) covers everything right of its own left
 * edge, at `step` from this card's. Once `step <= cardW / 2`, that centre
 * point — where a click or tap actually resolves — is under the neighbour
 * instead of this card, and nothing can select it. The margin past half keeps
 * the centre inside the exposed strip rather than on its boundary.
 *
 * `MIN_READABLE_STEP` alone held this while every hand card shared one small
 * fixed width; now that the width is the table's own continuous scale, the
 * floor has to scale with it.
 */
const EXPOSED_STRIP_RATIO = 0.6;

function readableStep(cardW: number): number {
  return Math.max(MIN_READABLE_STEP, cardW * EXPOSED_STRIP_RATIO);
}

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
 * `readableStep(cardW)`. Below that it holds and reports `scrollable`, so a
 * big hand overflows rather than losing a card to a clip or to occlusion.
 * `cardW` is the caller's own already-scaled hand card width.
 */
export function computeHandLayout(n: number, availW: number, cardW: number): HandLayout {
  if (n <= 1) {
    return { step: 0, totalW: cardW, scrollable: false };
  }
  const floor = readableStep(cardW);
  const idealStep = (availW - cardW) / (n - 1);
  if (idealStep >= floor) {
    const step = Math.min(cardW, idealStep);
    return { step, totalW: step * (n - 1) + cardW, scrollable: false };
  }
  return { step: floor, totalW: floor * (n - 1) + cardW, scrollable: true };
}
