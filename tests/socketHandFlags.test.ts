// tests/socketHandFlags.test.ts — regression coverage for recordPlayFlags:
// a human's AFK-forced move goes through autoMoveForSeat rather than the
// game:play handler, and must still record bomb/joker tracking — otherwise
// the purist / iron_will / wild_card achievements silently under-count
// whenever a player's forced-minimum card happens to be a lone joker. No
// socket server or database needed: server/socket.ts loads fine standalone
// (see tests/serverLoadable.test.ts's sibling modules), and __testables
// exposes the pure turn-resolution helpers for exactly this kind of test.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameState, Card } from "../lib/gameEngine.ts";
import { __testables } from "../server/socket.ts";

function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    players: [
      { id: "player_0", name: "Alice", hand: [], type: "human" },
      {
        id: "player_1",
        name: "Bob",
        hand: [{ id: "4_hearts", suit: "hearts", rank: "4", isJoker: false }],
        type: "human",
      },
    ],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: 0,
    passCount: 0,
    gameMode: "free_for_all",
    roundWinner: null,
    gameOver: false,
    rankings: [],
    firstPlayMade: true,
    ...overrides,
  };
}

test("an AFK-forced lone-joker play sets handFlags.joker (regression: used to be silently missed)", () => {
  const joker: Card = { id: "joker_bw", suit: null, rank: "joker_bw", isJoker: true };
  const state = baseState({
    players: [
      { id: "player_0", name: "Alice", hand: [joker], type: "human" },
      {
        id: "player_1",
        name: "Bob",
        hand: [{ id: "4_hearts", suit: "hearts", rank: "4", isJoker: false }],
        type: "human",
      },
    ],
  });

  // useAi = false is exactly the AFK-forced-human path (see autoMoveForSeat's
  // own doc comment): a new round with only a joker in hand forces it out as
  // the minimum legal play.
  const { state: next, handFlags } = __testables.autoMoveForSeatWithFlags(state, 0, false);

  assert.ok(next, "the forced joker play must succeed");
  assert.equal(next!.players[0].hand.length, 0, "the joker must actually have been played");
  assert.deepEqual(handFlags[0], { bomb: false, joker: true });
});

test("an AFK-forced ordinary single leaves handFlags empty for that seat", () => {
  const state = baseState({
    players: [
      {
        id: "player_0",
        name: "Alice",
        hand: [{ id: "5_hearts", suit: "hearts", rank: "5", isJoker: false }],
        type: "human",
      },
      {
        id: "player_1",
        name: "Bob",
        hand: [{ id: "4_hearts", suit: "hearts", rank: "4", isJoker: false }],
        type: "human",
      },
    ],
  });

  const { state: next, handFlags } = __testables.autoMoveForSeatWithFlags(state, 0, false);

  assert.ok(next);
  assert.equal(next!.players[0].hand.length, 0);
  assert.equal(handFlags[0]?.joker ?? false, false);
  assert.equal(handFlags[0]?.bomb ?? false, false);
});
