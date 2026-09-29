import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createSelectionStore,
  followHand,
  inMode,
  NO_SELECTION,
  press,
  type Selection,
} from "../../components/table/selection.ts";

const play = (...ids: string[]): Selection => ({ mode: "play", ids });
const pick = (...ids: string[]): Selection => ({ mode: "exchange", ids });

describe("a press", () => {
  test("toggles a card in and out of a play selection", () => {
    const one = press(NO_SELECTION, "7_hearts", "play");
    assert.deepEqual(one, play("7_hearts"));
    assert.deepEqual(press(one, "7_clubs", "play"), play("7_hearts", "7_clubs"));
    assert.deepEqual(press(play("7_hearts", "7_clubs"), "7_hearts", "play"), play("7_clubs"));
  });

  test("picks one card for the exchange: another replaces it, the same one drops it", () => {
    const first = press(inMode(NO_SELECTION, "exchange"), "9_spades", "exchange");
    assert.deepEqual(first, pick("9_spades"));
    assert.deepEqual(press(first, "K_hearts", "exchange"), pick("K_hearts"));
    assert.deepEqual(press(first, "9_spades", "exchange"), pick());
  });

  test("in the other mode starts from nothing", () => {
    assert.deepEqual(press(play("7_hearts", "7_clubs"), "9_spades", "exchange"), pick("9_spades"));
    assert.deepEqual(press(pick("9_spades"), "7_hearts", "play"), play("7_hearts"));
  });
});

describe("switching between play and exchange", () => {
  test("empties the selection, and staying put keeps it as it is", () => {
    const staged = play("7_hearts");
    assert.deepEqual(inMode(staged, "exchange"), pick());
    assert.deepEqual(inMode(pick("9_spades"), "play"), play());
    assert.equal(inMode(staged, "play"), staged);
  });
});

describe("the hand changing", () => {
  const HAND = ["7_hearts", "7_clubs", "9_spades"];

  test("drops a card that left it and keeps every staged card still held", () => {
    assert.deepEqual(
      followHand(play("7_hearts", "9_spades"), HAND, ["7_clubs", "9_spades"]),
      play("9_spades")
    );
  });

  test("clears the selection when a card arrives: a deal, or the exchange's received card", () => {
    assert.deepEqual(followHand(play("7_hearts"), HAND, [...HAND, "2_spades"]), play());
    assert.deepEqual(followHand(play("7_hearts"), ["9_spades"], HAND), play());
  });

  test("keeps it, as the same object, while the hand holds still: a rejected play", () => {
    const staged = play("7_hearts", "7_clubs");
    assert.equal(followHand(staged, HAND, [...HAND]), staged);
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
