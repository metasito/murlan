import { test } from "node:test";
import assert from "node:assert/strict";
import { createDeck, findStartingPlayer, HEADS_UP_HAND } from "../../lib/game/gameEngine.ts";
import { initializeOpeningAt } from "../../lib/e2eOpener.ts";

const deck = new Set(createDeck().map((c) => c.id));

test("the seat asked for opens from every deal start, and every card dealt is dealt exactly once", () => {
  for (const n of [2, 3, 4]) {
    const players = Array.from({ length: n }, (_, i) => ({ name: `p${i}`, type: i === 0 ? ("human" as const) : ("ai" as const) }));
    const dealt = n === 2 ? n * HEADS_UP_HAND : deck.size;
    for (let firstSeat = 0; firstSeat < n; firstSeat++) {
      for (let seat = 0; seat < n; seat++) {
        for (let run = 0; run < 20; run++) {
          const state = initializeOpeningAt(players, "free_for_all", firstSeat, seat);
          assert.equal(state.currentTurnIndex, seat);
          assert.equal(findStartingPlayer(state.players).playerIdx, seat);
          const ids = state.players.flatMap((p) => p.hand.map((c) => c.id));
          assert.equal(ids.length, dealt, `${n} seats deal ${dealt} cards`);
          assert.equal(new Set(ids).size, dealt, "a card was dealt twice");
          for (const id of ids) assert.ok(deck.has(id), `${id} is not in the deck`);
        }
      }
    }
  }
});
