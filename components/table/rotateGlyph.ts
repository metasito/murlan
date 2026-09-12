// The portrait cover's rotate glyph, as numbers. Its own `.ts` beside the `.tsx`
// that draws it, for the reason `components/flightPhysics.ts`'s header states.

/** A landscape phone glyph stood on its end, which is how the player holds it. */
export const ROTATE_UPRIGHT = 0;
/** Lying down: the pose the prompt is asking for, and where it comes to rest. */
export const ROTATE_SETTLED = 1;
const UPRIGHT_DEGREES = 90;

/** The glyph's angle at `turn`, upright at `ROTATE_UPRIGHT` and flat at `ROTATE_SETTLED`. */
export function rotateGlyphAngle(turn: number): number {
  "worklet";
  return (ROTATE_SETTLED - turn) * UPRIGHT_DEGREES;
}
