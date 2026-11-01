// What the hard tier sheds on a lead it cannot win outright, seen as the cards it plays.
import { test } from "node:test";
import assert from "node:assert/strict";
import { botChoosePlay } from "../../lib/game/bot.ts";
import { card as c, seat, viewOf } from "../support/game.ts";
import type { Card } from "../../lib/game/gameEngine.ts";

const lead = (hand: Card[]) =>
  botChoosePlay(
    viewOf(seat(0, hand, { type: "bot", personality: "gent" }), { opponentHandCounts: [9, 9, 9] }),
    () => 0.99
  )?.cards.map((x) => x.id).sort();

test("the hard tier sheds a pair of Kings before its lowest single", () => {
  const hand = [c("K", "clubs"), c("3", "clubs"), c("5", "diamonds"), c("7", "spades"),
    c("9", "hearts"), c("J", "diamonds"), c("A", "spades"), c("K", "hearts")];
  assert.deepEqual(lead(hand), ["K_clubs", "K_hearts"]);
});

test("between two pairs the hard tier sheds the lower", () => {
  const hand = [c("K", "clubs"), c("K", "hearts"), c("5", "clubs"), c("5", "hearts"),
    c("3", "clubs"), c("7", "spades"), c("9", "hearts"), c("J", "diamonds")];
  assert.deepEqual(lead(hand), ["5_clubs", "5_hearts"]);
});
