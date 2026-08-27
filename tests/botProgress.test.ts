// tests/botProgress.test.ts — the browser suite's runaway guard. A hand ends
// when someone runs out, so cards leaving hands is the only progress a game
// makes, and a game that keeps changing the table without ever moving that
// total is one that cannot end. Counting states rather than seconds is what
// keeps a slow runner from reading as a runaway (#433).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  cardsInHands,
  observeProgress,
  NO_PROGRESS_YET,
  type Progress,
} from "./e2e/helpers/bot.ts";

/** The shape components/gameTableModel.ts `describeTableForA11y` produces. */
const state = (you: number, luan: number, extra = "") =>
  `${extra}Hai ${you} cart${you === 1 ? "a" : "e"} in mano. ` +
  `Luan ha ${luan} cart${luan === 1 ? "a" : "e"} in mano.`;

const fold = (descs: string[]): Progress =>
  descs.reduce<Progress>((p, d) => observeProgress(p, d), NO_PROGRESS_YET);

describe("cardsInHands", () => {
  test("sums every hand the table announces, singular and plural alike", () => {
    assert.equal(cardsInHands(state(12, 11)), 23);
    assert.equal(cardsInHands(state(1, 1)), 2);
  });

  test("is null when the state names no hand at all", () => {
    assert.equal(cardsInHands("Fase di scambio: devi dare una carta a Luan."), null);
  });
});

describe("the runaway guard", () => {
  test("a game where cards keep leaving hands never goes stale", () => {
    const descs = [];
    for (let n = 13; n > 0; n--) descs.push(state(n, n));
    assert.equal(fold(descs).stale, 0);
  });

  test("counts states that change the table without moving a card", () => {
    // Passing round the table: the turn moves, the description changes, and
    // nobody's hand does.
    const descs = ["Tocca a Luan. ", "È il tuo turno. ", "Tocca a Luan. "].map((turn) =>
      state(12, 11, turn)
    );
    assert.equal(fold(descs).stale, descs.length - 1);
  });

  test("a fresh deal counts as progress, so a match does not accumulate", () => {
    // Between hands the total grows rather than shrinks. What a game that
    // cannot end never does is change it at all.
    const after = fold([state(2, 1), state(1, 1), state(13, 13)]);
    assert.equal(after.stale, 0);
    assert.equal(after.held, 26);
  });

  test("a state naming no hand neither advances nor stalls the count", () => {
    const before = fold([state(12, 11), state(12, 11)]);
    const after = observeProgress(before, "Fase di scambio: devi dare una carta a Luan.");
    assert.deepEqual(after, before);
  });

  test("the count is states, not seconds, so a slow runner reads the same", () => {
    // The whole point of #433: the identical sequence yields the identical
    // verdict however long the machine took over it.
    const descs = [state(12, 11), state(12, 11), state(12, 11)];
    assert.equal(fold(descs).stale, 2);
    assert.equal(fold(descs).stale, 2);
  });
});
