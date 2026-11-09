// tests/ui-rules/drawnFit.test.ts — the fits tests/e2e/tableRects.spec.ts holds the page to stay as tight
// as the drawn tables measured, and see what they are for.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fits, HINT_PER_GLYPH, TOLERANCE, unpriced, type Box } from "../helpers/drawnFit.ts";
import { noticeBox } from "../../components/table/noticeModel.ts";
import { TEXT_METRICS } from "../../components/table/textMetrics.generated.ts";

const EM = 14;
const LINEAR = 60;
const word = (words: string, drawn = LINEAR): Box["text"] => ({ words, em: EM, drawn, linear: LINEAR });
const ROW = { x: 100, y: 40, w: 120, h: 24 };
/** What the solver priced past linear for snapping. */
const OVERCOUNT = 5;

describe("the drawn fits stay as tight as the evidence", () => {
  test("a layout unit of rounding, no more", () => {
    assert.equal(TOLERANCE, 1);
  });

  test("a renderer may draw half a pixel a glyph off linear; only a glyph no face holds may fall short of its price", () => {
    assert.equal(HINT_PER_GLYPH, 0.5);
    assert.equal(unpriced(word("TURNO")!), 0);
    assert.equal(unpriced(word("💣")!), TEXT_METRICS.fallbackEm["U+1F4A3"] * EM);
    assert.equal(unpriced(word("★")!), TEXT_METRICS.fallbackEm["U+2605"] * EM);
    assert.equal(unpriced(word("你")!), (TEXT_METRICS.faces.bold.widestGlyph / TEXT_METRICS.faces.bold.upem) * EM);
  });
});

describe("the drawn fits see what they are for", () => {
  const priced = { ...ROW };
  const plate = (x: number, w: number, text = word("TURNO")): Box => ({ x, y: ROW.y, w, h: ROW.h, text });
  const linearW = ROW.w - OVERCOUNT;

  test("a centred chip that keeps its centre fits, one off it does not", () => {
    const x = ROW.x + OVERCOUNT / 2;
    assert.ok(fits.words(plate(x, linearW), priced, { align: "center", overcount: OVERCOUNT }));
    assert.ok(!fits.words(plate(x - 2, linearW), priced, { align: "center", overcount: OVERCOUNT }));
    assert.ok(!fits.words(plate(x + 2, linearW), priced, { align: "center", overcount: OVERCOUNT }));
  });

  test("a chip with no alignment or no overcount from the solver never fits", () => {
    assert.ok(!fits.words(plate(ROW.x, linearW), priced, { overcount: OVERCOUNT }));
    assert.ok(!fits.words(plate(ROW.x, linearW), priced, { align: "flex-start" }));
  });

  test("a plate priced one gap wider than it draws does not fit", () => {
    const gap = noticeBox("turn", 1).gap;
    assert.ok(gap > TOLERANCE, `a gap of ${gap}`);
    assert.ok(fits.words(plate(ROW.x, linearW), priced, { align: "flex-start", overcount: OVERCOUNT }));
    assert.ok(!fits.words(plate(ROW.x, linearW - gap), priced, { align: "flex-start", overcount: OVERCOUNT }));
  });

  test("words a hinting renderer draws narrower fit by what it drew them narrower, up to half a pixel a glyph", () => {
    const glyphs = 5;
    const within = HINT_PER_GLYPH * glyphs;
    assert.ok(fits.words(plate(ROW.x, linearW - within, word("TURNO", LINEAR - within)), priced, { align: "flex-start", overcount: OVERCOUNT }));
    assert.ok(!fits.words(plate(ROW.x, linearW - within - 1, word("TURNO", LINEAR - within - 1)), priced, { align: "flex-start", overcount: OVERCOUNT }));
    assert.ok(!fits.words(plate(ROW.x, linearW - within, word("TURNO")), priced, { align: "flex-start", overcount: OVERCOUNT }));
  });

  test("a pill beside a neighbour drawn narrower than priced may sit and run that much outside its rect, and no more", () => {
    const drift = 6;
    assert.ok(fits.words(plate(ROW.x - drift, linearW + drift), priced, { align: "flex-start", overcount: OVERCOUNT, drift }));
    assert.ok(!fits.words(plate(ROW.x - drift - 2, linearW + drift), priced, { align: "flex-start", overcount: OVERCOUNT, drift }));
    assert.ok(!fits.words(plate(ROW.x - drift, linearW + drift), priced, { align: "flex-start", overcount: OVERCOUNT }));
  });

  test("a plate drawn wider than its linear price does not fit", () => {
    assert.ok(!fits.words(plate(ROW.x, linearW + TOLERANCE + 0.5), priced, { align: "flex-start", overcount: OVERCOUNT }));
  });

  test("a name keeps its line's bottom and its label's alignment", () => {
    const name: Box = { x: ROW.x + ROW.w - linearW, y: ROW.y + 4, w: linearW, h: ROW.h - 4, text: word("BESNIK") };
    assert.ok(fits.line(name, priced, { align: "flex-end", overcount: OVERCOUNT }));
    assert.ok(!fits.line(name, priced, { align: "flex-start", overcount: OVERCOUNT }));
    assert.ok(!fits.line({ ...name, h: ROW.h - 6 }, priced, { align: "flex-end", overcount: OVERCOUNT }));
  });
});
