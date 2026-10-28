// #850 clause 2: a vacated seat reads as vacated — a boolean on the sanitized
// player, never server-written text (docs/GAME-RULES.md § Decisions). Every client
// renders it through its own t(); the server must never be able to leak a
// name into a locale it does not carry.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sanitizeStateForPlayer } from "../../server/game/gamePersistence.ts";
import type { GameState, Player } from "../../lib/game/gameEngine.ts";
import { aThreePlayed, card, seat, state as aState } from "../support/game.ts";

function player(id: string, name: string): Player {
  return { id, name, hand: [], type: id === "p1" ? "bot" : "human" };
}

function state(): GameState {
  return {
    players: [player("p0", "Alice"), player("p1", "Ghost")],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: -1,
    passCount: 0,
    gameMode: "free_for_all",
    roundOver: false,
    finishingOrder: [],
    openingCard: null,
    playedRanks: aThreePlayed(),
    lastMove: { seq: 0, kind: "deal" },
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

describe("sanitizeStateForPlayer shows each viewer only the hand they hold", () => {
  const table = () =>
    aState({
      players: [
        seat(0, [card("3", "spades"), card("K", "hearts")]),
        seat(1, [card("4", "clubs")]),
        seat(2, [card("5", "clubs"), card("6", "clubs"), card("7", "clubs")]),
      ],
    });
  const seated = { 0: "ana", 1: "besi", 2: "cami" };

  test("a seated viewer sees their own cards and only a count of everyone else's", () => {
    const sent = sanitizeStateForPlayer(table(), "besi", seated);
    assert.deepEqual(sent.players.map((p) => p.hand.map((c) => c.id)), [[], ["4_clubs"], []]);
    assert.deepEqual(sent.players.map((p) => p.handCount), [2, 1, 3]);
    assert.equal(sent.viewerSeatIndex, 1);
  });

  test("a spectator sees no hand at all, and no seat of their own", () => {
    const sent = sanitizeStateForPlayer(table(), "sam", seated);
    assert.deepEqual(sent.players.map((p) => p.hand), [[], [], []]);
    assert.deepEqual(sent.players.map((p) => p.handCount), [2, 1, 3]);
    assert.equal(sent.viewerSeatIndex, null);
  });
});
