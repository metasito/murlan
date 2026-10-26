// tests/engine/replay.test.ts — the fold from a stored move log back into a table state.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  replayStateAt,
  replayMoveCount,
  replayMoments,
  nextMoment,
  bombsPlayedBy,
  isReadableReplay,
} from "../../lib/game/replay.ts";
import { buildCombination } from "../../lib/game/gameEngine.ts";
import { card as c } from "../support/game.ts";
import { handCountOf } from "../../shared/protocol.ts";
import type { ReplayDto } from "../../lib/game/replay.ts";

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
  finishingOrder: ["player_0", "player_1"],
  opening: null,
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
  assert.equal(state.roundOver, false);
});

test("a state carries the trick and the counts of the move it names", () => {
  const state = replayStateAt(REPLAY, 0);
  assert.deepEqual(state.lastPlayedCombination?.cards.map((x) => x.id), ["3_spades"]);
  assert.equal(state.lastPlayedBy, 0);
  assert.deepEqual(handCounts(REPLAY, 0), [2, 3]);
  assert.equal(state.currentTurnIndex, 1, "the turn shows whoever moved next");
});

test("a pass takes nothing off the hand, and the trick-closing one clears the trick", () => {
  const state = replayStateAt(REPLAY, 2);
  assert.equal(state.lastPlayedCombination, null, "the round closed on that pass");
  assert.deepEqual(handCounts(REPLAY, 2), [2, 2]);
});

test("a pass short of the threshold leaves the trick standing", () => {
  const threeUp: ReplayDto = {
    ...REPLAY,
    seats: [
      { seatIndex: 0, userId: "u1", name: "Ana" },
      { seatIndex: 1, userId: null, name: "Gent" },
      { seatIndex: 2, userId: "u3", name: "Besnik" },
    ],
    finishingOrder: ["player_0", "player_1", "player_2"],
    moves: [
      { seat: 0, combo: single("3", "spades"), handCounts: [2, 3, 3] },
      { seat: 1, combo: single("5", "hearts"), handCounts: [2, 2, 3] },
      { seat: 2, combo: null, handCounts: [2, 2, 3] },
      { seat: 0, combo: null, handCounts: [2, 2, 3] },
    ],
  };
  const standing = replayStateAt(threeUp, 2);
  assert.deepEqual(standing.lastPlayedCombination?.cards.map((x) => x.id), ["5_hearts"]);
  assert.equal(standing.lastPlayedBy, 1);
  assert.equal(replayStateAt(threeUp, 3).lastPlayedCombination, null, "the second pass closed it");
});

test("the last index is the finished round", () => {
  const state = replayStateAt(REPLAY, replayMoveCount(REPLAY) - 1);
  assert.equal(state.roundOver, true);
  assert.deepEqual(state.finishingOrder, ["player_0", "player_1"]);
});

test("an index outside the log is clamped, never thrown", () => {
  assert.equal(replayStateAt(REPLAY, -99).lastPlayedCombination, null);
  assert.equal(replayStateAt(REPLAY, 99).roundOver, true);
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
  assert.equal(state.roundOver, false);
  assert.equal(replayMoveCount(empty), 0);
});

// ─── Jumping ─────────────────────────────────────────────────────────────────
//
// Stepping to move 40 of 60 means pressing next forty times. These are the
// moves a reader wants to reach directly, and they are derived from the log
// rather than stored.

const bomb = (rank: Parameters<typeof c>[0]) =>
  buildCombination([c(rank, "hearts"), c(rank, "diamonds"), c(rank, "clubs"), c(rank, "spades")])!;

const withMoves = (moves: ReplayDto["moves"]): ReplayDto => ({ ...REPLAY, moves });

test("every bomb is a moment, and so is the last move", () => {
  const replay = withMoves([
    { seat: 0, combo: single("3", "spades"), handCounts: [2, 3] },
    { seat: 1, combo: bomb("7"), handCounts: [2, 2] },
    { seat: 0, combo: null, handCounts: [2, 2] },
    { seat: 1, combo: bomb("9"), handCounts: [2, 1] },
    { seat: 0, combo: single("4", "hearts"), handCounts: [1, 1] },
  ]);

  assert.deepEqual(replayMoments(replay), [
    { index: 1, kind: "bomb" },
    { index: 3, kind: "bomb" },
    { index: 4, kind: "end" },
  ]);
});

test("a bomb that ends the round is one moment, not two", () => {
  const replay = withMoves([
    { seat: 0, combo: single("3", "spades"), handCounts: [2, 3] },
    { seat: 1, combo: bomb("7"), handCounts: [2, 0] },
  ]);

  assert.deepEqual(replayMoments(replay), [{ index: 1, kind: "bomb" }]);
});

test("a replay with no moves has nothing to jump to", () => {
  assert.deepEqual(replayMoments(withMoves([])), []);
});

test("the next moment is the first one after here, and wraps at the end", () => {
  const moments = replayMoments(
    withMoves([
      { seat: 0, combo: bomb("7"), handCounts: [2, 3] },
      { seat: 1, combo: single("5", "hearts"), handCounts: [2, 2] },
      { seat: 0, combo: bomb("9"), handCounts: [1, 2] },
    ])
  );

  assert.equal(nextMoment(moments, -1)?.index, 0, "from the opening position");
  assert.equal(nextMoment(moments, 0)?.index, 2, "past the bomb it is already on");
  assert.equal(nextMoment(moments, 2)?.index, 0, "wraps rather than dead-ending");
  assert.equal(nextMoment([], 0), null);
});

test("bombs are counted for the seat that threw them, not the table", () => {
  const replay = withMoves([
    { seat: 0, combo: bomb("7"), handCounts: [2, 3] },
    { seat: 1, combo: bomb("9"), handCounts: [2, 2] },
    { seat: 0, combo: bomb("K"), handCounts: [1, 2] },
    { seat: 0, combo: single("4", "hearts"), handCounts: [0, 2] },
  ]);

  assert.equal(bombsPlayedBy(replay, "u1"), 2);
});

test("a player who did not sit at this table threw nothing", () => {
  // A bot seat carries no userId, so its bombs are nobody's — and neither the
  // stranger nor the bot may be credited with the seated player's two.
  const replay = withMoves([
    { seat: 0, combo: bomb("7"), handCounts: [2, 3] },
    { seat: 1, combo: bomb("9"), handCounts: [2, 2] },
  ]);

  assert.equal(bombsPlayedBy(replay, "someone-else"), 0);
  assert.equal(bombsPlayedBy(replay, ""), 0);
});

test("a round with no bombs counts none", () => {
  assert.equal(bombsPlayedBy(REPLAY, "u1"), 0);
});

// ─── Edges of the fold ───────────────────────────────────────────────────────

const royal = () =>
  buildCombination(
    (["3", "4", "5", "6", "7"] as const).map((rank) => c(rank, "hearts"))
  )!;

test("the opening position has no trick and nobody holding it", () => {
  const state = replayStateAt(REPLAY, -1);
  assert.equal(state.lastPlayedBy, -1);
  assert.equal(state.lastPlayedCombination, null);
});

test("a round is finished at its last move even when the log is one move long", () => {
  const one = withMoves([{ seat: 0, combo: single("3", "spades"), handCounts: [0, 3] }]);
  const state = replayStateAt(one, 0);
  assert.equal(state.roundOver, true);
  assert.deepEqual(state.finishingOrder, ["player_0", "player_1"]);
});

test("mid-round nobody has finished", () => {
  const state = replayStateAt(REPLAY, 1);
  assert.equal(state.roundOver, false);
  assert.deepEqual(state.finishingOrder, []);
});

test("every seat is drawn as a person, bot or not", () => {
  assert.deepEqual(
    replayStateAt(REPLAY, 0).players.map((p) => p.type),
    ["human", "human"]
  );
});

// A stored row is not typed: a log that opens on a pass must still render.
test("a log that opens on a pass closes no trick", () => {
  const passFirst = withMoves([{ seat: 0, combo: null, handCounts: [3, 0] }]);
  assert.deepEqual(handCounts(passFirst, -1), [3, 0]);
  const state = replayStateAt(passFirst, 0);
  assert.equal(state.lastMove?.kind, "pass");
  assert.equal((state.lastMove as { closedTrick?: boolean }).closedTrick, false);
});

test("a royal straight is a moment, named royal", () => {
  const replay = withMoves([
    { seat: 0, combo: single("3", "spades"), handCounts: [7, 3] },
    { seat: 1, combo: royal(), handCounts: [7, 0] },
  ]);
  assert.deepEqual(replayMoments(replay), [{ index: 1, kind: "royal" }]);
  const mid = withMoves([
    { seat: 0, combo: royal(), handCounts: [2, 3] },
    { seat: 1, combo: single("5", "hearts"), handCounts: [2, 2] },
  ]);
  assert.deepEqual(replayMoments(mid), [
    { index: 0, kind: "royal" },
    { index: 1, kind: "end" },
  ]);
});

test("a one-move round has its end as a moment", () => {
  const one = withMoves([{ seat: 0, combo: single("3", "spades"), handCounts: [0, 3] }]);
  assert.deepEqual(replayMoments(one), [{ index: 0, kind: "end" }]);
});

test("an earlier bomb does not stop the last move being a moment, and a final bomb is not doubled", () => {
  const earlier = withMoves([
    { seat: 0, combo: bomb("7"), handCounts: [2, 3] },
    { seat: 1, combo: single("5", "hearts"), handCounts: [2, 2] },
  ]);
  assert.deepEqual(replayMoments(earlier), [
    { index: 0, kind: "bomb" },
    { index: 1, kind: "end" },
  ]);
  const both = withMoves([
    { seat: 0, combo: bomb("7"), handCounts: [2, 3] },
    { seat: 1, combo: bomb("9"), handCounts: [2, 0] },
  ]);
  assert.deepEqual(replayMoments(both), [
    { index: 0, kind: "bomb" },
    { index: 1, kind: "bomb" },
  ]);
});

// ─── A stored row is not typed ───────────────────────────────────────────────

test("a well-formed replay is readable, seat 0 included, and so is an empty log", () => {
  assert.equal(isReadableReplay(REPLAY), true);
  assert.equal(isReadableReplay(withMoves([])), true);
});

test("a replay without a seat list or a move list is unreadable, not a throw", () => {
  assert.equal(isReadableReplay({ ...REPLAY, seats: "x", moves: [] } as never), false);
  assert.equal(isReadableReplay({ ...REPLAY, moves: "x" } as never), false);
  assert.equal(isReadableReplay({ ...REPLAY, moves: undefined } as never), false);
});

test("a move must carry one hand count per seat", () => {
  const bad = (move: unknown) => isReadableReplay(withMoves([move as never]));
  assert.equal(bad({ seat: 0, combo: null }), false, "no counts");
  assert.equal(bad(null), false, "a null move");
  assert.equal(bad({ seat: 0, combo: null, handCounts: [1] }), false, "too few");
  assert.equal(bad({ seat: 0, combo: null, handCounts: [1, 1, 1] }), false, "too many");
  assert.equal(bad({ seat: 0, combo: null, handCounts: "ab" }), false, "not a list");
  assert.equal(bad({ seat: 0, combo: null, handCounts: [1, 1] }), true);
});

test("a move must name a seat that sits at the table", () => {
  const at = (seat: unknown) =>
    isReadableReplay(withMoves([{ seat, combo: null, handCounts: [1, 1] } as never]));
  assert.equal(at(0), true);
  assert.equal(at(1), true);
  assert.equal(at(2), false, "one past the last seat");
  assert.equal(at(-1), false);
  assert.equal(at(0.5), false);
  assert.equal(at("1"), false);
  assert.equal(at(undefined), false);
});

test("one bad move among good ones makes the replay unreadable", () => {
  const good = { seat: 0, combo: null, handCounts: [1, 1] };
  assert.equal(
    isReadableReplay(withMoves([good, { seat: 5, combo: null, handCounts: [1, 1] }, good])),
    false
  );
});
