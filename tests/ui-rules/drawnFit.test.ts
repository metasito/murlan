// tests/ui-rules/drawnFit.test.ts — the fits tests/e2e/tableRects.spec.ts holds the page to stay as tight
// as the drawn tables measured, and see what they are for.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fits, HINT_PER_GLYPH, TOLERANCE, unpriced, type Box } from "../helpers/drawnFit.ts";

const EM = 14;
const word = (words: string): Box["text"] => ({ words, em: EM });
const ROW = { x: 100, y: 40, w: 120, h: 24 };

describe("the drawn fits stay as tight as the evidence", () => {
  test("a layout unit of rounding, no more", () => {
    assert.equal(TOLERANCE, 1);
  });

  test("a priced glyph may fall two pixels short, a glyph no face holds an em", () => {
    assert.equal(HINT_PER_GLYPH, 1);
    assert.equal(unpriced(word("TURNO")!), 10);
    assert.equal(unpriced(word("你")!), EM);
  });
});

describe("the drawn fits see what they are for", () => {
  const priced = { ...ROW };
  const drawnAt = (x: number, w: number): Box => ({ x, y: ROW.y, w, h: ROW.h, text: word("TURNO") });

  test("a centred chip that keeps its centre fits, one off it does not", () => {
    assert.ok(fits.words(drawnAt(102, 116), priced, "center"));
    assert.ok(!fits.words(drawnAt(100, 116), priced, "center"));
    assert.ok(!fits.words(drawnAt(104, 116), priced, "center"));
  });

  test("a chip with no alignment from the solver never fits", () => {
    assert.ok(!fits.words(drawnAt(102, 116), priced, undefined));
  });

  test("words short of their price by more than two pixels a glyph do not fit", () => {
    assert.ok(fits.words(drawnAt(100, 120 - 10 - TOLERANCE), priced, "flex-start"));
    assert.ok(!fits.words(drawnAt(100, 120 - 10 - TOLERANCE - 0.5), priced, "flex-start"));
  });

  test("a name keeps its line's bottom and its label's alignment", () => {
    const name: Box = { x: 220 - 115, y: ROW.y + 4, w: 115, h: ROW.h - 4, text: word("BESNIK") };
    assert.ok(fits.line(name, priced, "flex-end"));
    assert.ok(!fits.line(name, priced, "flex-start"));
    assert.ok(!fits.line({ ...name, h: ROW.h - 6 }, priced, "flex-end"));
  });
});
