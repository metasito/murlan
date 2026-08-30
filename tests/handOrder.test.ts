// tests/handOrder.test.ts — the order a player sets on their own hand.
//
// The gesture is a browser's to prove (tests/e2e/reorderHand.spec.ts); the
// arithmetic under it is not, and it is where the whole feature can go wrong
// silently: an order that drops a card, duplicates one, or quietly forgets
// itself the next time the server hands the array back in its own order.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyHandOrder, cardAt, dropIndex, moveCard } from "../components/handOrder.ts";
import type { Card } from "../lib/gameEngine.ts";

/** Cards by rank alone — the suit plays no part in any of this. */
function hand(...ranks: string[]): Card[] {
  return ranks.map((rank) => ({ rank, suit: "spades", isJoker: false, id: `${rank}_spades` })) as Card[];
}

const ids = (cards: readonly Card[]) => cards.map((c) => c.id);

test("with no order stored, the hand is the engine's own", () => {
  const cards = hand("3", "4", "5");
  assert.deepEqual(ids(applyHandOrder(cards, [])), ids(cards));
});

test("a stored order is what the player sees", () => {
  const cards = hand("3", "4", "5");
  assert.deepEqual(
    ids(applyHandOrder(cards, ["5_spades", "3_spades", "4_spades"])),
    ["5_spades", "3_spades", "4_spades"]
  );
});

test("the server re-sorting its own array changes nothing", () => {
  const order = ["5_spades", "3_spades", "4_spades"];
  const shuffled = hand("4", "5", "3");
  assert.deepEqual(ids(applyHandOrder(shuffled, order)), order);
});

test("a card the order has never seen keeps the place the engine gave it", () => {
  // The exchange hands back one card mid-manche. It belongs between the two
  // cards it sorts between, and neither of them may move for it.
  const cards = hand("3", "4", "5", "6");
  const order = ["6_spades", "3_spades", "5_spades"];
  assert.deepEqual(
    ids(applyHandOrder(cards, order)),
    ["6_spades", "3_spades", "4_spades", "5_spades"]
  );
});

test("a new card below everything the order holds goes to the front", () => {
  const cards = hand("3", "4", "5");
  assert.deepEqual(
    ids(applyHandOrder(cards, ["5_spades", "4_spades"])),
    ["3_spades", "5_spades", "4_spades"]
  );
});

test("two new cards arrive in the engine's order, not reversed", () => {
  const cards = hand("3", "4", "5", "6");
  assert.deepEqual(
    ids(applyHandOrder(cards, ["6_spades"])),
    ["3_spades", "4_spades", "5_spades", "6_spades"]
  );
});

test("a card that has left the hand takes its place in the order with it", () => {
  const cards = hand("3", "5");
  assert.deepEqual(
    ids(applyHandOrder(cards, ["5_spades", "4_spades", "3_spades"])),
    ["5_spades", "3_spades"]
  );
});

test("every card appears exactly once, whatever the order says", () => {
  const cards = hand("3", "4", "5", "6", "7");
  for (const order of [
    [],
    ["7_spades"],
    ["7_spades", "7_spades"],
    ["9_spades", "4_spades", "3_spades"],
    ["7_spades", "6_spades", "5_spades", "4_spades", "3_spades"],
  ]) {
    const out = ids(applyHandOrder(cards, order));
    assert.deepEqual([...out].sort(), ids(cards).sort(), `order ${JSON.stringify(order)}`);
    assert.equal(new Set(out).size, out.length, `order ${JSON.stringify(order)} duplicated a card`);
  }
});

// ─── moveCard ────────────────────────────────────────────────────────────────

test("a card dropped at a slot lands there", () => {
  assert.deepEqual(moveCard(["a", "b", "c"], "a", 2), ["b", "c", "a"]);
  assert.deepEqual(moveCard(["a", "b", "c"], "c", 0), ["c", "a", "b"]);
  assert.deepEqual(moveCard(["a", "b", "c"], "b", 1), ["a", "b", "c"]);
});

test("a slot past either end is the end", () => {
  assert.deepEqual(moveCard(["a", "b", "c"], "a", 99), ["b", "c", "a"]);
  assert.deepEqual(moveCard(["a", "b", "c"], "c", -4), ["c", "a", "b"]);
});

test("moving a card the hand does not hold changes nothing but adds nothing", () => {
  assert.deepEqual(moveCard(["a", "b"], "z", 1), ["a", "z", "b"]);
});

// ─── dropIndex ───────────────────────────────────────────────────────────────
//
// The slots are the gaps between the cards *left behind*, so a hand of five
// being dragged offers five: before each of the four remaining, and after the
// last.

test("the slot is the nearest one to the finger, not the card under it", () => {
  const xs = [0, 40, 80, 120];
  const cardW = 60;
  assert.equal(dropIndex(xs, cardW, -20), 0);
  assert.equal(dropIndex(xs, cardW, 38), 1);
  assert.equal(dropIndex(xs, cardW, 300), 4);
});

test("an empty rest offers exactly one slot", () => {
  assert.equal(dropIndex([], 60, 999), 0);
});

// ─── cardAt ──────────────────────────────────────────────────────────────────

test("the card under the finger is the one drawn on top of the others", () => {
  // Four cards 40 apart, 60 wide: every one but the last is half-covered by
  // its neighbour, so x=50 is inside both card 0 and card 1.
  const xs = [0, 40, 80, 120];
  assert.equal(cardAt(xs, 60, 50), 1);
  assert.equal(cardAt(xs, 60, 10), 0);
  assert.equal(cardAt(xs, 60, 170), 3);
});

test("a finger off either end of the row is on no card", () => {
  assert.equal(cardAt([0, 40], 60, -1), null);
  assert.equal(cardAt([0, 40], 60, 101), null);
  assert.equal(cardAt([], 60, 0), null);
});

test("the last slot sits a whole card past the last card, not on it", () => {
  // Two cards 40 apart, 60 wide. The trailing slot is at 40+60=100, so 90 is
  // past the last card and belongs after it.
  assert.equal(dropIndex([0, 40], 60, 90), 2);
  assert.equal(dropIndex([0, 40], 60, 55), 1);
});
