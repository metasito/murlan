// tests/replayShape.test.ts — how a hand's move log is built and who it belongs to.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendReplayMove,
  replayPlayerIdsOf,
  replaySeatsOf,
  startReplayLog,
} from "../server/replayShape.ts";
import { MAX_REPLAY_MOVES } from "../lib/replay.ts";
import { buildCombination, c } from "./helpers.ts";

/** Only `players[].hand.length` is read, so a stub of that shape is enough. */
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
    { seatIndex: 0, userId: "u1", name: "Ana" },
    { seatIndex: 1, userId: null, name: "Gent" },
  ]);
});

test("a play records its combination and the counts that followed", () => {
  const game = { moveLog: startReplayLog() };
  appendReplayMove(game, 0, buildCombination([c("3", "spades")])!, after([12, 13]));
  assert.equal(game.moveLog!.length, 1);
  assert.equal(game.moveLog![0].seat, 0);
  assert.deepEqual(game.moveLog![0].handCounts, [12, 13]);
  assert.deepEqual(game.moveLog![0].combo?.cards.map((x) => x.id), ["3_spades"]);
});

test("a pass records a null combination", () => {
  const game = { moveLog: startReplayLog() };
  appendReplayMove(game, 1, null, after([12, 13]));
  assert.equal(game.moveLog![0].combo, null);
});

test("a log past the cap is dropped, not silently truncated", () => {
  const game: { moveLog: ReturnType<typeof startReplayLog> | null } = { moveLog: startReplayLog() };
  for (let i = 0; i <= MAX_REPLAY_MOVES; i++) appendReplayMove(game, 0, null, after([1, 1]));
  assert.equal(game.moveLog, null);
});

test("appending to an abandoned log is a no-op", () => {
  const game: { moveLog: null } = { moveLog: null };
  appendReplayMove(game, 0, null, after([1, 1]));
  assert.equal(game.moveLog, null);
});
