// How a box the browser drew must sit on the rect `tableRects` solved for it: tests/e2e/tableRects.spec.ts
// applies these to the page, tests/ui-rules/drawnFit.test.ts holds them to the evidence.
import { aligned, type Align } from "../../components/flexAlign.ts";
import type { Rect } from "../../components/tableRects.ts";
import { SNAP_PER_GLYPH } from "../../components/table/noticeWidth.ts";
import { TEXT_METRICS } from "../../components/table/textMetrics.generated.ts";

/**
 * How the solver's rect holds what the page draws.
 * - `same`: to the layout's rounding.
 * - `words`: a pill. Its height and line are the plate's; its width is a bound, and the drawn words sit
 *   in the priced rect as the solver's `aligns` says: a centred chip keeps its centre. `noticeWidth`
 *   prices a glyph at most `SNAP_PER_GLYPH` above its linear advance, which a renderer that positions
 *   glyphs by subpixel draws, and a glyph the bundled faces lack at a full em, so the drawn words may
 *   fall short of the price by that much a glyph.
 * - `inside`: a knob of its own fixed size, centred in the slot the solver gives it.
 * - `line`: a seat's name. Its words are priced as a pill's, and the label reserves a taller line
 *   than the font draws, under which the drawn line sits: the bottoms meet, the top may be lower.
 */
export type Fit = "same" | "inside" | "words" | "line";

export interface Box extends Rect {
  /** A text box's words and the largest font size it sets them in. */
  text?: { words: string; em: number };
}

/** Layout rounds each edge to a device pixel, and a border's half pixel to one either side. */
export const TOLERANCE = 1;

const PRICED = new Set(Object.values(TEXT_METRICS.faces).flatMap((f) => Object.keys(f.advances)));

/** How far short of the priced width the drawn words may fall: `words` above. */
export const unpriced = (text: { words: string; em: number }) =>
  [...text.words].reduce((sum, ch) => sum + (PRICED.has(ch) ? SNAP_PER_GLYPH : text.em), 0);

const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE;
const placed = (a: Rect, b: Rect, align: Align | undefined) => align !== undefined && near(a.x, aligned(align, b.x, b.w, a.w)) && a.w <= b.w + TOLERANCE;
const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export const fits: Record<Fit, (a: Box, b: Rect, align: Align | undefined) => boolean> = {
  same: (a, b) => near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w) && near(a.h, b.h),
  inside: (a, b) => near(centre(a).x, centre(b).x) && near(centre(a).y, centre(b).y) && a.w <= b.w + TOLERANCE && a.h <= b.h + TOLERANCE,
  words: (a, b, align) => near(a.y, b.y) && near(a.h, b.h) && placed(a, b, align) && b.w - a.w <= unpriced(a.text!) + TOLERANCE,
  line: (a, b, align) => near(a.y + a.h, b.y + b.h) && a.y >= b.y - TOLERANCE && placed(a, b, align) && b.w - a.w <= unpriced(a.text!) + TOLERANCE,
};
