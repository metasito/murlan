// How a box the browser drew must sit on the rect `tableRects` solved for it: tests/e2e/tableRects.spec.ts
// applies these to the page, tests/ui-rules/drawnFit.test.ts holds them to the evidence.
import { aligned, type Align } from "../../components/flexAlign.ts";
import type { Rect } from "../../components/tableRects.ts";
import { FALLBACK_EM } from "../../components/table/noticeWidth.ts";
import { TEXT_METRICS } from "../../components/table/textMetrics.generated.ts";

/**
 * How the solver's rect holds what the page draws.
 * - `same`: to the layout's rounding.
 * - `words`: a pill. Its height and line are the plate's, and the drawn words sit in the priced rect
 *   as the solver's `aligns` says: a centred chip keeps its centre. Its width is held at linear
 *   advances on both sides: the solver's rect less its `overcount`, against the drawn box less what
 *   the renderer drew its words away from their linear width, measured in the page. A renderer that
 *   hints lands each advance on a whole pixel: CI's Chrome 156 draws "Scegli una carta da 3 a 10 per
 *   Besnik" 6.4px narrower than linear, under `HINT_PER_GLYPH`. A glyph the bundled faces lack is
 *   priced at `FALLBACK_EM`, which the drawn one may fall short of.
 * - `inside`: a knob of its own fixed size, centred in the slot the solver gives it.
 * - `line`: a seat's name. Its words are held as a pill's, and the label reserves a taller line
 *   than the font draws, under which the drawn line sits: the bottoms meet, the top may be lower.
 */
export type Fit = "same" | "inside" | "words" | "line";

export interface Box extends Rect {
  /**
   * A text box's words, the largest font size it sets them in, and their width twice: as drawn, and
   * at linear advances in the same font, size, tracking, case and features.
   */
  text?: { words: string; em: number; drawn: number; linear: number };
}

/** What the solver says of a rect sized by priced words: `TableRects.aligns` and `.overcount`. */
export interface Priced {
  align?: Align;
  overcount?: number;
}

/** Layout rounds each edge to a device pixel, and a border's half pixel to one either side. */
export const TOLERANCE = 1;

/** How far from its linear width a renderer may draw words, per glyph: `words` above. */
export const HINT_PER_GLYPH = 0.5;

const PRICED = new Set(Object.values(TEXT_METRICS.faces).flatMap((f) => Object.keys(f.advances)));

/** How far short of the linear price the drawn words may fall: the fallback price of each glyph no face holds. */
export const unpriced = (text: { words: string; em: number }) => [...text.words].reduce((sum, ch) => sum + (PRICED.has(ch) ? 0 : FALLBACK_EM * text.em), 0);

const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE;
const placed = (a: Rect, b: Rect, align: Align | undefined) => align !== undefined && near(a.x, aligned(align, b.x, b.w, a.w)) && a.w <= b.w + TOLERANCE;
const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

function linearly(a: Box, b: Rect, overcount: number | undefined): boolean {
  const text = a.text!;
  if (overcount === undefined) return false;
  const hinted = text.drawn - text.linear;
  if (Math.abs(hinted) > HINT_PER_GLYPH * [...text.words].length) return false;
  const [drawn, solved] = [a.w - hinted, b.w - overcount];
  return drawn <= solved + TOLERANCE && solved - drawn <= unpriced(text) + TOLERANCE;
}

export const fits: Record<Fit, (a: Box, b: Rect, priced: Priced) => boolean> = {
  same: (a, b) => near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w) && near(a.h, b.h),
  inside: (a, b) => near(centre(a).x, centre(b).x) && near(centre(a).y, centre(b).y) && a.w <= b.w + TOLERANCE && a.h <= b.h + TOLERANCE,
  words: (a, b, p) => near(a.y, b.y) && near(a.h, b.h) && placed(a, b, p.align) && linearly(a, b, p.overcount),
  line: (a, b, p) => near(a.y + a.h, b.y + b.h) && a.y >= b.y - TOLERANCE && placed(a, b, p.align) && linearly(a, b, p.overcount),
};
