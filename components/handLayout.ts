// Pure layout math for StraightHand's card row (components/GameShared.tsx).
//
// This lives in its own JSX-free .ts file (rather than inside GameShared.tsx
// directly) so it can be unit-tested with `node --test`: Node's built-in
// TypeScript loader only type-strips plain .ts source — it cannot parse a
// .tsx file's JSX ("Unknown file extension \".tsx\""). Keep this file free of
// JSX and of any import from a .tsx file, or the test suite breaks.

/** Width of a full-size card. Mirrors CardView.tsx `styles.cardNormal.width`. Re-exported from GameShared.tsx as the canonical `CARD_W`. */
export const CARD_W = 58;

// ─── Minimum readable overlap step ─────────────────────────────────────────
//
// Derived from CardView.tsx's corner geometry, not guessed:
//   - `styles.cardInner` has `padding: 4` on every side.
//   - `styles.topCorner` stacks the rank label over the suit glyph, flush
//     against that padded top-left corner (`alignItems: "flex-start"`).
//   - `styles.rankTextNormal` is `fontSize: 15`, `fontFamily:
//     "Rajdhani_700Bold"` — bold, fairly condensed numerals.
//   - `styles.suitCorner` is `fontSize: 11`, a single glyph — always
//     narrower than the rank label above it.
// The widest rank label is the two-character "10" (every other rank is a
// single glyph). For the next, overlapping card to leave this corner
// readable, the step has to clear the card's left padding plus the width of
// "10" set in 15px bold. Condensed bold digits run close to 0.6em/character.
const CARD_INNER_PADDING = 4;
const RANK_FONT_SIZE = 15;
const RANK_CHAR_WIDTH_EM = 0.6;
const WIDEST_RANK_CHAR_COUNT = 2; // "10"

/** Smallest overlap step (px) that keeps an overlapped card's rank/suit corner legible. */
export const MIN_READABLE_STEP = Math.ceil(
  CARD_INNER_PADDING + RANK_FONT_SIZE * RANK_CHAR_WIDTH_EM * WIDEST_RANK_CHAR_COUNT
);

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
