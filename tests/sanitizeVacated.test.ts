// #850 clause 2: a vacated seat reads as vacated — a boolean on the sanitized
// player, never server-written text (docs/BRIEF.md §3.1). Every client
// renders it through its own t(); the server must never be able to leak a
// name into a locale it does not carry.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sanitizeStateForPlayer } from "../server/gamePersistence.ts";
import type { GameState, Player } from "../lib/gameEngine.ts";

function player(id: string, name: string): Player {
  return { id, name, hand: [], type: id === "p1" ? "ai" : "human" };
}

function state(): GameState {
  return {
    players: [player("p0", "Alice"), player("p1", "Ghost")],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: -1,
    passCount: 0,
    gameMode: "free_for_all",
    roundWinner: null,
    gameOver: false,
    rankings: [],
    firstPlayMade: true,
  };
}

describe("sanitizeStateForPlayer carries `vacated` as a boolean, never a message (#850 clause 2)", () => {
  test("the vacated seat's player reads vacated: true, its own name intact", () => {
    const sanitized = sanitizeStateForPlayer(
      state(),
      "alice",
      { 0: "alice" },
      undefined,
      new Map([[1, { userId: "ghost", username: "Ghost" }]])
    );
    assert.equal(sanitized.players[1]!.vacated, true);
    assert.equal(sanitized.players[1]!.name, "Ghost", "the name is untouched — only the flag is new");
  });

  test("a seat nobody vacated reads vacated: false", () => {
    const sanitized = sanitizeStateForPlayer(state(), "alice", { 0: "alice", 1: "bob" }, undefined, new Map());
    assert.equal(sanitized.players[0]!.vacated, false);
    assert.equal(sanitized.players[1]!.vacated, false);
  });

  test("no vacatedSeats map at all (offline-shaped call) still answers false, not undefined", () => {
    const sanitized = sanitizeStateForPlayer(state(), "alice", { 0: "alice", 1: "bob" });
    assert.equal(sanitized.players[0]!.vacated, false);
  });
});
