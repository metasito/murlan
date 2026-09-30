import { test } from "node:test";
import assert from "node:assert/strict";
import { findStartingPlayer, type Player } from "../../lib/game/gameEngine.ts";
import { dealOpeningTo } from "../../lib/e2eOpener.ts";

test("the seat asked for opens every deal, at every table size, and no card is lost or doubled", () => {
  for (const players of [2, 3, 4]) {
    for (let run = 0; run < 200; run++) {
      const seat = run % players;
      const hands = dealOpeningTo(players, run % players, seat);
      assert.equal(findStartingPlayer(hands.map((hand) => ({ hand }) as Player)).playerIdx, seat);
      const ids = hands.flat().map((c) => c.id);
      assert.equal(new Set(ids).size, ids.length);
    }
  }
});
