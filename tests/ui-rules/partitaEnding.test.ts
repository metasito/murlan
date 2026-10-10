import { test } from "node:test";
import assert from "node:assert/strict";
import { MANCHE_IDLE, mancheGlow, mancheOpen, mancheRerank, mancheRowCount, mancheRowPop } from "../../lib/game/mancheEnding.ts";
import {
  PARTITA_STEPS,
  partitaActions,
  partitaBoard,
  partitaDim,
  partitaEndingOnsets,
  partitaWinnerBox,
} from "../../lib/game/partitaEnding.ts";

for (const seats of [2, 3, 4]) {
  test(`a ${seats}-seat partita ends on the mockup's onsets`, () => {
    assert.deepEqual(partitaEndingOnsets(seats), {
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
  assert.equal(mancheOpen(599, PARTITA_STEPS), 0);
  assert.ok(mancheOpen(600 + 120, PARTITA_STEPS) > 0.9);
  assert.equal(mancheOpen(840, PARTITA_STEPS), 1);
  assert.equal(mancheOpen(60_000, PARTITA_STEPS), 1);
  assert.equal(mancheGlow(60_000, true, PARTITA_STEPS), 0);
});

test("gains pop at +800 + 100i, count over 450 ms and stay on the board", () => {
  [800, 900, 1000, 1100].forEach((at, i) => {
    assert.equal(mancheRowPop(at - 1, i, PARTITA_STEPS), 0);
    assert.equal(mancheRowCount(at - 1, i, PARTITA_STEPS), 0);
    assert.equal(mancheRowPop(at + 180, i, PARTITA_STEPS), 1);
    assert.ok(mancheRowCount(at + 449, i, PARTITA_STEPS) < 1);
    assert.equal(mancheRowCount(at + 450, i, PARTITA_STEPS), 1);
    assert.equal(mancheRowPop(60_000, i, PARTITA_STEPS), 1);
  });
});

test("the rows re-rank from +1350 over 300 ms", () => {
  assert.equal(mancheRerank(1350, PARTITA_STEPS), 0);
  assert.equal(mancheRerank(1500, PARTITA_STEPS), 0.5);
  assert.equal(mancheRerank(1650, PARTITA_STEPS), 1);
});

test("the pill morphs into the board from +1600 over 600 ms, the table dimming to 0.6 over 400 ms", () => {
  assert.equal(partitaBoard(1599), 0);
  assert.equal(partitaBoard(1900), 0.5);
  assert.equal(partitaBoard(2200), 1);
  assert.equal(partitaDim(1599), 0);
  assert.ok(partitaDim(1800) > 0 && partitaDim(1800) < 0.6);
  assert.equal(partitaDim(2000), 0.6);
});

test("the winner box fades in at +2100 and the actions at +2600, each over 300 ms", () => {
  assert.equal(partitaWinnerBox(2099), 0);
  assert.ok(partitaWinnerBox(2250) > 0.5 && partitaWinnerBox(2250) < 1);
  assert.equal(partitaWinnerBox(2400), 1);
  assert.equal(partitaActions(2599), 0);
  assert.equal(partitaActions(2900), 1);
});

test("with no ending running there is no board, no dim and nothing to press", () => {
  assert.equal(partitaBoard(MANCHE_IDLE), 0);
  assert.equal(partitaDim(MANCHE_IDLE), 0);
  assert.equal(partitaWinnerBox(MANCHE_IDLE), 0);
  assert.equal(partitaActions(MANCHE_IDLE), 0);
});
