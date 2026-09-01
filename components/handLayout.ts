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
 * hand of five is not a hand of eighteen spread thin, and a full hand does
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

/**
 * The strip of card `i` that a tap belongs to, as a width from its own left
 * edge. Every card but the last is covered from `step` on by the one drawn over
 * it, so that strip is all of it a finger can reach.
 *
 * This is the hand's whole hit-testing rule, and it is here rather than in the
 * component because the platforms do not agree on what happens when a card's
 * ink overflows its strip: the web hit-tests the overflow and lets paint order
 * settle it, and UIKit does not hit-test outside a view's bounds at all. So the
 * card is drawn inside a box that takes no hits, and this decides the rest.
 */
export function hitWidth(i: number, n: number, step: number, cardW: number): number {
  return i === n - 1 ? cardW : step;
}

/**
 * The index of the card a tap at `x` belongs to, `x` measured from the left
 * edge of card 0. Null when the tap is off the row on either side.
 */
export function cardAtX(x: number, n: number, step: number, cardW: number): number | null {
  if (x < 0 || n <= 0) return null;
  const last = n - 1;
  if (x >= last * step) return x < last * step + cardW ? last : null;
  // Every card before the last owns exactly one step, so which one is division.
  return step > 0 ? Math.floor(x / step) : 0;
}

/**
 * Which slot a drawn card takes when the row is holding one open for a card
 * still arriving. Everything from the waiting slot onward steps past it, so the
 * gap is where the card will actually land rather than at an end of the row.
 *
 * `undefined` means nothing is arriving and the row is its own length.
 */
export function slotForCard(i: number, arrivingIndex: number | undefined): number {
  return arrivingIndex === undefined || i < arrivingIndex ? i : i + 1;
}
