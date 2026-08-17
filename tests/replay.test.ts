// tests/replay.test.ts — the fold from a stored move log back into a table state.
import { test } from "node:test";
import assert from "node:assert/strict";
import { replayStateAt, replayMoveCount } from "../lib/replay.ts";
import { buildCombination } from "../lib/gameEngine.ts";
import { c } from "./helpers.ts";
import { handCountOf } from "../components/gameTableModel.ts";
import type { ReplayDto } from "../lib/replay.ts";

const single = (rank: Parameters<typeof c>[0], suit: Parameters<typeof c>[1]) =>
  buildCombination([c(rank, suit)])!;

const handCounts = (replay: ReplayDto, index: number) =>
  replayStateAt(replay, index).players.map(handCountOf);

const REPLAY: ReplayDto = {
  id: "r1",
  finishedAt: "2026-08-16T10:00:00.000Z",
  gameMode: "free_for_all",
  seats: [
    { seatIndex: 0, userId: "u1", name: "Ana" },
    { seatIndex: 1, userId: null, name: "Gent" },
  ],
  rankings: ["player_0", "player_1"],
  moves: [
    { seat: 0, combo: single("3", "spades"), handCounts: [2, 3] },
    { seat: 1, combo: single("5", "hearts"), handCounts: [2, 2] },
    { seat: 0, combo: null, handCounts: [2, 2] },
  ],
};

test("the opening position adds the first move's cards back to its own seat", () => {
  const state = replayStateAt(REPLAY, -1);
  assert.deepEqual(handCounts(REPLAY, -1), [3, 3]);
  assert.equal(state.lastPlayedCombination, null);
  assert.equal(state.currentTurnIndex, 0);
  assert.equal(state.gameOver, false);
});

test("a state carries the pile and the counts of the move it names", () => {
  const state = replayStateAt(REPLAY, 0);
  assert.deepEqual(state.lastPlayedCombination?.cards.map((x) => x.id), ["3_spades"]);
  assert.equal(state.lastPlayedBy, 0);
  assert.deepEqual(handCounts(REPLAY, 0), [2, 3]);
  assert.equal(state.currentTurnIndex, 1, "the turn shows whoever moved next");
});

test("a pass leaves the pile standing and takes nothing off the hand", () => {
  const state = replayStateAt(REPLAY, 2);
  assert.deepEqual(state.lastPlayedCombination?.cards.map((x) => x.id), ["5_hearts"]);
  assert.equal(state.lastPlayedBy, 1);
  assert.deepEqual(handCounts(REPLAY, 2), [2, 2]);
});

test("the last index is the finished hand", () => {
  const state = replayStateAt(REPLAY, replayMoveCount(REPLAY) - 1);
  assert.equal(state.gameOver, true);
  assert.deepEqual(state.rankings, ["player_0", "player_1"]);
});

test("an index outside the log is clamped, never thrown", () => {
  assert.equal(replayStateAt(REPLAY, -99).lastPlayedCombination, null);
  assert.equal(replayStateAt(REPLAY, 99).gameOver, true);
});

test("every hand is empty — a replay never reveals what anyone held", () => {
  for (let i = -1; i < replayMoveCount(REPLAY); i++) {
    for (const p of replayStateAt(REPLAY, i).players) assert.deepEqual(p.hand, []);
  }
});

test("an empty log still renders an opening position", () => {
  const empty: ReplayDto = { ...REPLAY, moves: [] };
  const state = replayStateAt(empty, -1);
  assert.equal(state.players.length, 2);
  assert.equal(state.gameOver, false);
  assert.equal(replayMoveCount(empty), 0);
});
