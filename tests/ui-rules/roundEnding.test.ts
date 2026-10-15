import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROUND_IDLE,
  ROUND_STEPS as S,
  roundEndingOnsets,
  roundGlow,
  roundOpen,
  roundRerank,
  roundRowCount,
  roundRowPop,
} from "../../lib/game/roundEnding.ts";

for (const seats of [2, 3, 4]) {
  test(`a ${seats}-seat round ends on the mockup's onsets`, () => {
    assert.deepEqual(roundEndingOnsets(seats), {
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
  const { open, close, settled } = roundEndingOnsets(4);
  assert.equal(roundOpen(open - 1, S), 0);
  assert.ok(roundOpen(open + 120, S) > 0.9, "a back-out is most of the way open halfway through");
  assert.equal(roundOpen(close, S), 1);
  assert.ok(roundOpen(close + 125, S) > 0 && roundOpen(close + 125, S) < 1);
  assert.equal(roundOpen(settled, S), 0);
  assert.equal(roundOpen(ROUND_IDLE, S), 0);
});

test("each row pops and counts in at its own onset, in finishing order", () => {
  const { gains, settled } = roundEndingOnsets(4);
  gains.forEach((at, i) => {
    assert.equal(roundRowPop(at - 1, i, S), 0);
    assert.equal(roundRowCount(at - 1, i, S), 0);
    assert.equal(roundRowPop(at + 180, i, S), 1);
    assert.ok(roundRowCount(at + 250, i, S) > 0.5 && roundRowCount(at + 250, i, S) < 1);
    assert.equal(roundRowCount(at + 500, i, S), 1);
    assert.equal(roundRowPop(settled, i, S), 0, "the gain hides again once the pill has closed");
  });
});

test("the rows re-rank between their onsets and are in the new order once settled", () => {
  const { rerank, settled } = roundEndingOnsets(3);
  assert.equal(roundRerank(rerank, S), 0);
  assert.equal(roundRerank(rerank + 150, S), 0.5);
  assert.equal(roundRerank(rerank + 300, S), 1);
  assert.equal(roundRerank(settled, S), 1);
});

test("the gold glow runs from the close's end only when the viewer's total changed", () => {
  const { settled, glowEnd } = roundEndingOnsets(2);
  assert.equal(roundGlow(settled - 1, true, S), 0);
  assert.equal(roundGlow(settled, true, S), 1);
  assert.equal(roundGlow(glowEnd, true, S), 0);
  assert.equal(roundGlow(settled, false, S), 0);
});

test("with no ending running the pill shows the settled standings", () => {
  assert.equal(roundRowPop(ROUND_IDLE, 0, S), 0);
  assert.equal(roundRowCount(ROUND_IDLE, 0, S), 1);
  assert.equal(roundRerank(ROUND_IDLE, S), 1);
  assert.equal(roundGlow(ROUND_IDLE, true, S), 0);
});
