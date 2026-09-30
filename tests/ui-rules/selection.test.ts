import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createSelectionStore,
  NO_SELECTION,
  press,
  settle,
  type Selection,
} from "../../components/table/selection.ts";

const HAND = ["7_hearts", "7_clubs", "9_spades"];
const play = (...ids: string[]): Selection => ({ mode: "play", ids, held: HAND });
const pick = (...ids: string[]): Selection => ({ mode: "exchange", ids, held: HAND });

describe("a press", () => {
  test("toggles a card in and out of a play selection", () => {
    const one = press(settle(NO_SELECTION, HAND, "play"), "7_hearts");
    assert.deepEqual(one, play("7_hearts"));
    assert.deepEqual(press(one, "7_clubs"), play("7_hearts", "7_clubs"));
    assert.deepEqual(press(play("7_hearts", "7_clubs"), "7_hearts"), play("7_clubs"));
  });

  test("picks one card for the exchange: another replaces it, the same one drops it", () => {
    const first = press(settle(NO_SELECTION, HAND, "exchange"), "9_spades");
    assert.deepEqual(first, pick("9_spades"));
    assert.deepEqual(press(first, "7_hearts"), pick("7_hearts"));
    assert.deepEqual(press(first, "9_spades"), pick());
  });
});

describe("switching between play and exchange", () => {
  test("empties the selection, and staying put keeps it as it is", () => {
    const staged = play("7_hearts");
    assert.deepEqual(settle(staged, HAND, "exchange"), pick());
    assert.deepEqual(settle(pick("9_spades"), HAND, "play"), play());
    assert.equal(settle(staged, HAND, "play"), staged);
  });
});

describe("the hand changing", () => {
  test("drops a card that left it and keeps every staged card still held", () => {
    const after = ["7_clubs", "9_spades"];
    assert.deepEqual(settle(play("7_hearts", "9_spades"), after, "play"), {
      mode: "play",
      ids: ["9_spades"],
      held: after,
    });
  });

  test("clears the selection when a card arrives: a deal, or the exchange's received card", () => {
    const dealt = [...HAND, "2_spades"];
    assert.deepEqual(settle(play("7_hearts"), dealt, "play"), { mode: "play", ids: [], held: dealt });
  });

  test("keeps it, as the same object, while the hand holds still: a rejected play", () => {
    const staged = play("7_hearts", "7_clubs");
    assert.equal(settle(staged, [...HAND], "play"), staged);
  });
});

describe("the store", () => {
  test("reads back what was set and tells each subscriber once per change", () => {
    const store = createSelectionStore();
    let heard = 0;
    const stop = store.subscribe(() => heard++);
    assert.equal(store.get(), NO_SELECTION);

    const next = play("7_hearts");
    store.set(next);
    assert.equal(store.get(), next);
    assert.equal(heard, 1);

    store.set(next);
    assert.equal(heard, 1, "setting the same selection is no change");

    stop();
    store.set(play());
    assert.equal(heard, 1, "an unsubscribed listener hears nothing");
  });
});
