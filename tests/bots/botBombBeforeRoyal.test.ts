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

test("the hard tier's emergency answer is its lowest royal straight, whichever is found first", () => {
  // Two 5s make the mixed 3-7 a plain straight, so the spade 9-K royal is enumerated before the heart 3-7 one.
  const royals = [
    c("3", "hearts"), c("4", "hearts"), c("5", "hearts"), c("6", "hearts"), c("7", "hearts"), c("5", "diamonds"),
    c("9", "spades"), c("10", "spades"), c("J", "spades"), c("Q", "spades"), c("K", "spades"),
  ];
  const player = seat(0, royals, { type: "bot", personality: "gent" });
  const top = buildCombination([c("2", "hearts")])!;

  const choice = botChoosePlay(viewOf(player, { toBeat: top, opponentHandCounts: [1, 6, 6] }), () => 0.99);

  assert.equal(choice?.type, "royal_straight");
  assert.deepEqual(choice!.cards.map((x) => x.rank).sort(), ["3", "4", "5", "6", "7"]);
});
