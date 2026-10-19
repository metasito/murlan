import { test } from "node:test";
import assert from "node:assert/strict";
import { ROUND_IDLE, roundGlow, roundOpen, roundRerank, roundRowCount, roundRowPop } from "../../lib/timeline/roundEnding.ts";
import {
  MATCH_STEPS,
  matchActions,
  matchBoard,
  matchDim,
  matchEndingOnsets,
  matchWinnerBox,
} from "../../lib/timeline/matchEnding.ts";

for (const seats of [2, 3, 4]) {
  test(`a ${seats}-seat match ends on the mockup's onsets`, () => {
    assert.deepEqual(matchEndingOnsets(seats), {
      open: 600,
      gains: [800, 900, 1000, 1100].slice(0, seats),
      rerank: 1350,
      board: 1600,
      winnerBox: 2100,
      actions: 2600,
      settled: 2900,
    });
  });
}

test("the pill opens at +600 and never closes: it becomes the board", () => {
  assert.equal(roundOpen(599, MATCH_STEPS), 0);
  assert.ok(roundOpen(600 + 120, MATCH_STEPS) > 0.9);
  assert.equal(roundOpen(840, MATCH_STEPS), 1);
  assert.equal(roundOpen(60_000, MATCH_STEPS), 1);
  assert.equal(roundGlow(60_000, true, MATCH_STEPS), 0);
});

test("gains pop at +800 + 100i, count over 450 ms and stay on the board", () => {
  [800, 900, 1000, 1100].forEach((at, i) => {
    assert.equal(roundRowPop(at - 1, i, MATCH_STEPS), 0);
    assert.equal(roundRowCount(at - 1, i, MATCH_STEPS), 0);
    assert.equal(roundRowPop(at + 180, i, MATCH_STEPS), 1);
    assert.ok(roundRowCount(at + 449, i, MATCH_STEPS) < 1);
    assert.equal(roundRowCount(at + 450, i, MATCH_STEPS), 1);
    assert.equal(roundRowPop(60_000, i, MATCH_STEPS), 1);
  });
});

test("the rows re-rank from +1350 over 300 ms", () => {
  assert.equal(roundRerank(1350, MATCH_STEPS), 0);
  assert.equal(roundRerank(1500, MATCH_STEPS), 0.5);
  assert.equal(roundRerank(1650, MATCH_STEPS), 1);
});

test("the pill morphs into the board from +1600 over 600 ms, the table dimming to 0.6 over 400 ms", () => {
  assert.equal(matchBoard(1599), 0);
  assert.equal(matchBoard(1900), 0.5);
  assert.equal(matchBoard(2200), 1);
  assert.equal(matchDim(1599), 0);
  assert.ok(matchDim(1800) > 0 && matchDim(1800) < 0.6);
  assert.equal(matchDim(2000), 0.6);
});

test("the winner box fades in at +2100 and the actions at +2600, each over 300 ms", () => {
  assert.equal(matchWinnerBox(2099), 0);
  assert.ok(matchWinnerBox(2250) > 0.5 && matchWinnerBox(2250) < 1);
  assert.equal(matchWinnerBox(2400), 1);
  assert.equal(matchActions(2599), 0);
  assert.equal(matchActions(2900), 1);
});

test("with no ending running there is no board, no dim and nothing to press", () => {
  assert.equal(matchBoard(ROUND_IDLE), 0);
  assert.equal(matchDim(ROUND_IDLE), 0);
  assert.equal(matchWinnerBox(ROUND_IDLE), 0);
  assert.equal(matchActions(ROUND_IDLE), 0);
});
