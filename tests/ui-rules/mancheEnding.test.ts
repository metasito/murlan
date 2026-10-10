import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MANCHE_IDLE,
  MANCHE_STEPS as S,
  mancheEndingOnsets,
  mancheGlow,
  mancheOpen,
  mancheRerank,
  mancheRowCount,
  mancheRowPop,
} from "../../lib/game/mancheEnding.ts";

for (const seats of [2, 3, 4]) {
  test(`a ${seats}-seat manche ends on the mockup's onsets`, () => {
    assert.deepEqual(mancheEndingOnsets(seats), {
      open: 700,
      gains: [900, 1020, 1140, 1260].slice(0, seats),
      rerank: 1500,
      close: 2150,
      settled: 2400,
      pileFade: 2350,
      deal: 2500,
      glowEnd: 3300,
    });
  });
}

test("the pill opens at its onset, holds open, and is closed once settled", () => {
  const { open, close, settled } = mancheEndingOnsets(4);
  assert.equal(mancheOpen(open - 1, S), 0);
  assert.ok(mancheOpen(open + 120, S) > 0.9, "a back-out is most of the way open halfway through");
  assert.equal(mancheOpen(close, S), 1);
  assert.ok(mancheOpen(close + 125, S) > 0 && mancheOpen(close + 125, S) < 1);
  assert.equal(mancheOpen(settled, S), 0);
  assert.equal(mancheOpen(MANCHE_IDLE, S), 0);
});

test("each row pops and counts in at its own onset, in finishing order", () => {
  const { gains, settled } = mancheEndingOnsets(4);
  gains.forEach((at, i) => {
    assert.equal(mancheRowPop(at - 1, i, S), 0);
    assert.equal(mancheRowCount(at - 1, i, S), 0);
    assert.equal(mancheRowPop(at + 180, i, S), 1);
    assert.ok(mancheRowCount(at + 250, i, S) > 0.5 && mancheRowCount(at + 250, i, S) < 1);
    assert.equal(mancheRowCount(at + 500, i, S), 1);
    assert.equal(mancheRowPop(settled, i, S), 0, "the gain hides again once the pill has closed");
  });
});

test("the rows re-rank between their onsets and are in the new order once settled", () => {
  const { rerank, settled } = mancheEndingOnsets(3);
  assert.equal(mancheRerank(rerank, S), 0);
  assert.equal(mancheRerank(rerank + 150, S), 0.5);
  assert.equal(mancheRerank(rerank + 300, S), 1);
  assert.equal(mancheRerank(settled, S), 1);
});

test("the gold glow runs from the close's end only when the viewer's total changed", () => {
  const { settled, glowEnd } = mancheEndingOnsets(2);
  assert.equal(mancheGlow(settled - 1, true, S), 0);
  assert.equal(mancheGlow(settled, true, S), 1);
  assert.equal(mancheGlow(glowEnd, true, S), 0);
  assert.equal(mancheGlow(settled, false, S), 0);
});

test("with no ending running the pill shows the settled standings", () => {
  assert.equal(mancheRowPop(MANCHE_IDLE, 0, S), 0);
  assert.equal(mancheRowCount(MANCHE_IDLE, 0, S), 1);
  assert.equal(mancheRerank(MANCHE_IDLE, S), 1);
  assert.equal(mancheGlow(MANCHE_IDLE, true, S), 0);
});
