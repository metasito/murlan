import { test } from "node:test";
import assert from "node:assert/strict";
import { botChoosePlay } from "../../lib/game/bot.ts";
import { buildCombination } from "../../lib/game/gameEngine.ts";
import { card as c, seat } from "../support/game.ts";

test("a bot holding a bomb and a royal straight spends the bomb on a play both beat", () => {
  const hand = [
    c("Q", "hearts"), c("Q", "diamonds"), c("Q", "clubs"), c("Q", "spades"),
    c("3", "spades"), c("4", "spades"), c("5", "spades"), c("6", "spades"), c("7", "spades"),
    c("J", "hearts"),
  ];
  const player = seat(0, hand, { type: "bot", personality: "gent" });
  const top = buildCombination([c("2", "hearts")])!;

  const choice = botChoosePlay(player, top, false, [1, 6, 6], undefined, () => 0);

  assert.equal(choice?.type, "bomb");
});
