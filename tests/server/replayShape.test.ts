// tests/server/replayShape.test.ts — how a round's move log is built and who it belongs to.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendReplayMove,
  replayPlayerIdsOf,
  replaySeatsOf,
} from "../../server/game/replayShape.ts";
import { MAX_REPLAY_MOVES, type ReplayMove } from "../../lib/game/replay.ts";
import { card as c } from "../support/game.ts";
import { buildCombination } from "../../lib/game/gameEngine.ts";

/** Only `players[].hand.length` is read, so a stub of that shape is enough. */
const DEALT = { lastMove: { seq: 0, kind: "deal" } } as const;

const after = (counts: number[]) => ({
  players: counts.map((n) => ({ hand: new Array(n).fill(c("3", "spades")) })),
});

test("player ids exclude bot seats", () => {
  assert.deepEqual(
    replayPlayerIdsOf([
      { seatIndex: 0, userId: "u1", name: "Ana" },
      { seatIndex: 1, userId: null, name: "Gent" },
      { seatIndex: 2, userId: "u2", name: "Drita" },
    ]),
    ["u1", "u2"]
  );
});

test("a replay with no human seat belongs to nobody", () => {
  assert.deepEqual(replayPlayerIdsOf([{ seatIndex: 0, userId: null, name: "Gent" }]), []);
});

test("seats come from the engine state and the player map together", () => {
  assert.deepEqual(replaySeatsOf([{ name: "Ana" }, { name: "Gent" }], { 0: "u1" }), [
    { seatIndex: 0, userId: "u1", vacatedBy: null, name: "Ana" },
    { seatIndex: 1, userId: null, vacatedBy: null, name: "Gent" },
  ]);
});

test("a seat somebody left still says who left it, without granting them the replay", () => {
  const seats = replaySeatsOf(
    [{ name: "Ana" }, { name: "Drita" }],
    { 1: "u2" },
    new Map([[0, { userId: "u1" }]])
  );
  assert.deepEqual(seats[0], { seatIndex: 0, userId: null, vacatedBy: "u1", name: "Ana" });
  assert.deepEqual(replayPlayerIdsOf(seats), ["u2"]);
});

test("a play records its combination and the counts that followed", () => {
  const game: { moveLog: ReplayMove[] | null } = { moveLog: [] };
  appendReplayMove(game, 0, buildCombination([c("3", "spades")])!, DEALT, after([12, 13]));
  assert.equal(game.moveLog!.length, 1);
  assert.equal(game.moveLog![0].seat, 0);
  assert.deepEqual(game.moveLog![0].handCounts, [12, 13]);
  assert.deepEqual(game.moveLog![0].combo?.cards.map((x) => x.id), ["3_spades"]);
});

test("the first move alone records what it was made against", () => {
  const game: { moveLog: ReplayMove[] | null } = { moveLog: [] };
  appendReplayMove(game, 3, null, { lastMove: { seq: 1, kind: "giveback", seat: 0 } }, after([12, 13]));
  appendReplayMove(game, 2, null, DEALT, after([12, 13]));
  assert.deepEqual(game.moveLog!.map((m) => m.opening), [{ seq: 1, kind: "giveback", seat: 0 }, undefined]);
});

test("a pass records a null combination", () => {
  const game: { moveLog: ReplayMove[] | null } = { moveLog: [] };
  appendReplayMove(game, 1, null, DEALT, after([12, 13]));
  assert.equal(game.moveLog![0].combo, null);
});

test("a log past the cap is dropped, not silently truncated", () => {
  const game: { moveLog: ReplayMove[] | null } = { moveLog: [] };
  for (let i = 0; i <= MAX_REPLAY_MOVES; i++) appendReplayMove(game, 0, null, DEALT, after([1, 1]));
  assert.equal(game.moveLog, null);
});

test("appending to an abandoned log is a no-op", () => {
  const game: { moveLog: null } = { moveLog: null };
  appendReplayMove(game, 0, null, DEALT, after([1, 1]));
  assert.equal(game.moveLog, null);
});
