import { test } from "node:test";
import assert from "node:assert/strict";
import { moveSince, stepSince, turnOf } from "../../lib/game/moves.ts";
import type { LastMove } from "../../lib/game/gameEngine.ts";

const deal: LastMove = { seq: 0, kind: "deal" };
const play: LastMove = { seq: 3, kind: "play", seat: 1 };
const pass: LastMove = { seq: 4, kind: "pass", seat: 2, closedTrick: false };

test("with nothing seen, the move is new", () => {
  assert.equal(moveSince(null, deal), deal);
  assert.equal(moveSince(undefined, pass), pass);
});

test("the move already seen is not new, whichever object carries it", () => {
  assert.equal(moveSince(pass, pass), null);
  assert.equal(moveSince({ ...pass }, pass), null, "a re-sent state parses into a new object");
});

test("a later move is new", () => {
  assert.equal(moveSince(play, pass), pass);
});

test("the next round's deal is new after the last round's moves", () => {
  assert.equal(moveSince(pass, deal), deal);
});

test("a move that shares a count with one from another round is still new", () => {
  assert.equal(moveSince({ seq: 4, kind: "play", seat: 2 }, pass), pass);
  assert.equal(moveSince({ seq: 4, kind: "pass", seat: 1, closedTrick: false }, pass), pass);
});

test("a step is the move straight after the one seen, and only that", () => {
  assert.equal(stepSince(play, pass), pass);
  assert.equal(stepSince(pass, pass), null, "nothing new");
  assert.equal(stepSince(pass, play), null, "a rewind");
  assert.equal(stepSince(deal, pass), null, "a jump past moves never seen");
  assert.equal(stepSince(null, deal), null, "nothing seen to step from");
});

test("the turn key moves with the move count", () => {
  assert.equal(turnOf({ lastMove: pass }), "4");
  assert.notEqual(turnOf({ lastMove: play }), turnOf({ lastMove: pass }));
});
