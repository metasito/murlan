// tests/socketHandFlags.test.ts — pure turn and rematch logic, exercised
// against the modules that own it with no socket server and no database.
//
// Covers two independent things:
//  - recordPlayFlags: a human's AFK-forced move goes through autoMoveForSeat
//    rather than the game:play handler, and must still record bomb/joker
//    tracking — otherwise the purist / iron_will / wild_card achievements
//    silently under-count whenever a player's forced-minimum card happens to
//    be a lone joker.
//  - countRematchAnswers/tableWantsRematch: the rematch verdict over a mix
//    of seated and vacated/bot seats.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameState, Card } from "../lib/gameEngine.ts";
import { autoMoveForSeat } from "../server/gameTurn.ts";
import type { AutoMovable } from "../server/gameTurn.ts";
import { countRematchAnswers, tableWantsRematch } from "../server/gameOver.ts";

/**
 * The flags an automated move leaves behind, which the returned GameState
 * cannot carry: recordPlayFlags writes them onto the game, not the state.
 */
function autoMoveWithFlags(state: GameState, seat: number, useAi: boolean) {
  const game: AutoMovable = { gameState: state, handFlags: {}, moveLog: null };
  const next = autoMoveForSeat(game, seat, useAi);
  return { state: next, handFlags: game.handFlags };
}

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
  const { state: next, handFlags } = autoMoveWithFlags(state, 0, false);

  assert.ok(next, "the forced joker play must succeed");
  assert.equal(next!.players[0].hand.length, 0, "the joker must actually have been played");
  assert.deepEqual(handFlags[0], { bomb: false, joker: true });
});

function seatPlayers(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `seat_${i}`,
    name: `Seat ${i}`,
    hand: [],
    type: "human" as const,
  }));
}

// Minimal OnlineGameState for countRematchAnswers/tableWantsRematch: only
// gameState.players.length, playerMap and rematchIntents are read by either
// function, but every other field still needs a structurally valid
// placeholder.
function rematchGame(overrides: {
  seats: number;
  playerMap: Record<number, string>;
  rematchIntents: Map<string, boolean>;
}) {
  return {
    gameState: baseState({ players: seatPlayers(overrides.seats) }),
    playerMap: overrides.playerMap,
    roomId: "room_1",
    joinCode: "ROOM01",
    rematchVotes: new Set<string>(),
    rematchIntents: overrides.rematchIntents,
    cumulativeScores: {},
    gameMode: "free_for_all" as const,
    maxPlayers: overrides.seats,
    matchTarget: 21,
    matchLength: "match" as const,
    handsPlayed: 1,
    matchOver: true,
    handFlags: {},
    abandonedSeats: new Map<number, string>(),
    releasedSeats: new Set<string>(),
    spectators: new Set<string>(),
    moveLog: null,
    dealFirstSeat: 0,
  };
}

test("a lone seated human is a majority of 1 — the three bot seats abstain", () => {
  const game = rematchGame({
    seats: 4,
    playerMap: { 0: "u1" },
    rematchIntents: new Map([["u1", true]]),
  });

  assert.deepEqual(countRematchAnswers(game), { yes: 1, total: 1 });
  assert.equal(tableWantsRematch(game), true);
});

test("a human-only table's denominator is unchanged: all four seats count", () => {
  const game = rematchGame({
    seats: 4,
    playerMap: { 0: "u1", 1: "u2", 2: "u3", 3: "u4" },
    rematchIntents: new Map([
      ["u1", true],
      ["u2", true],
    ]),
  });

  assert.deepEqual(countRematchAnswers(game), { yes: 2, total: 4 });
  assert.equal(tableWantsRematch(game), false, "2 of 4 is not strictly more than half");
});

test("a seat that never answered counts as a no but still counts toward total", () => {
  const game = rematchGame({
    seats: 3,
    playerMap: { 0: "u1", 1: "u2", 2: "u3" },
    rematchIntents: new Map([
      ["u1", true],
      ["u2", true],
    ]),
  });

  assert.deepEqual(countRematchAnswers(game), { yes: 2, total: 3 });
  assert.equal(tableWantsRematch(game), true);
});

test("a table with no seated humans has total 0 and does not throw", () => {
  const game = rematchGame({
    seats: 4,
    playerMap: {},
    rematchIntents: new Map(),
  });

  assert.deepEqual(countRematchAnswers(game), { yes: 0, total: 0 });
  assert.equal(tableWantsRematch(game), false);
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

  const { state: next, handFlags } = autoMoveWithFlags(state, 0, false);

  assert.ok(next);
  assert.equal(next!.players[0].hand.length, 0);
  assert.equal(handFlags[0]?.joker ?? false, false);
  assert.equal(handFlags[0]?.bomb ?? false, false);
});
