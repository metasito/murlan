import { test } from "node:test";
import assert from "node:assert/strict";
import { botChoosePlay } from "../../lib/game/bot.ts";
import { BOT_PERSONALITIES } from "../../lib/game/botPersonalities.ts";
import { buildCombination } from "../../lib/game/gameEngine.ts";
import { card as c, seat, viewOf } from "../support/game.ts";

const hand = [
  c("Q", "hearts"), c("Q", "diamonds"), c("Q", "clubs"), c("Q", "spades"),
  c("3", "spades"), c("4", "spades"), c("5", "spades"), c("6", "spades"), c("7", "spades"),
  c("J", "hearts"),
];

for (const personality of BOT_PERSONALITIES) {
  for (const rngValue of [0, 0.99]) {
    test(`${personality.id} holding a bomb and a royal straight never spends the royal first (rng ${rngValue})`, () => {
      const player = seat(0, hand, { type: "bot", personality: personality.id });
      const top = buildCombination([c("2", "hearts")])!;

      const choice = botChoosePlay(viewOf(player, { toBeat: top, opponentHandCounts: [1, 6, 6] }), () => rngValue);

      assert.notEqual(choice?.type, "royal_straight");
    });
  }
}
