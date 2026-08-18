// Pure layout math for StraightHand's card row (components/GameShared.tsx).
//
// This lives in its own JSX-free .ts file (rather than inside GameShared.tsx
// directly) so it can be unit-tested with `node --test`: Node's built-in
// TypeScript loader only type-strips plain .ts source — it cannot parse a
// .tsx file's JSX ("Unknown file extension \".tsx\""). Keep this file free of
// JSX and of any import from a .tsx file, or the test suite breaks.

import { CARD_W } from "./cardFaceModel.ts";

export { CARD_W };

// ─── Minimum overlap step ──────────────────────────────────────────────────
//
// WCAG 2.2 SC 2.5.8 Target Size (Minimum), Level AA: 24x24 CSS px, or the
// undersized-target exception, which requires that 24px circles centred on
// adjacent targets not intersect. Adjacent card centres are exactly `step`
// apart, so a step below 24 fails both the size test and the exception.
//
// 44pt is not reachable here: at 14 cards it needs ~630px of hand width, which
// only a redesign — a two-row hand, or reclaiming the side buttons — provides.
// tests/e2e/tapTargets.spec.ts names the hand as its one deliberate exception.

/** Smallest overlap step (px) that keeps a card its own tappable target. */
export const MIN_READABLE_STEP = 24;

export interface HandLayout {
  /** Horizontal distance (px) between each card's left edge. */
  step: number;
  /** Total width (px) spanned by the row: left edge of card 0 to the right edge of the last card. */
  totalW: number;
  /**
   * True when `totalW` exceeds `availW`. The caller must let the row
   * overflow inside a horizontally scrollable container rather than clip it
   * or shrink `step` further — a smaller step would make the corner
   * unreadable, which the brief explicitly rules out.
   */
  scrollable: boolean;
}

/**
 * Pure layout for StraightHand's card row. Valid for any `n` from 0 up
 * (0/1 card need no overlap math) and any `availW` a landscape-locked game
 * screen can realistically hand it.
 *
 * The overlap step shrinks smoothly as `n` grows or `availW` shrinks, down
 * to `MIN_READABLE_STEP`. If even the minimum step can't fit all `n` cards
 * inside `availW` (a big hand — up to 27 cards in a 2-player game — on a
 * narrow device), the step holds at the readable minimum and `scrollable`
 * is reported `true` so the row can grow past `availW` inside a
 * horizontally scrollable container instead of clipping any card.
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
