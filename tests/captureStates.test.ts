// tests/captureStates.test.ts — the list a capture is asked for.
//
// `lib/captureStates.ts` is the contract between the web loop and the person
// holding an iOS device: a Playwright run and a photograph are only comparable
// while both are of the same named state. What this pins is the part of that
// contract a renderer cannot check — that each state's stated side is where its
// seat actually renders, that the four lamp positions are all covered, and that
// a card still appears exactly once once the pile has taken two out of a hand.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CAPTURE_STATES,
  CAPTURE_VIEWER_SEAT,
  captureGameState,
  captureStateById,
  nextTurn,
} from "../lib/captureStates.ts";
import { seatDirection } from "../components/gameTableModel.ts";
import { createDeck } from "../lib/gameEngine.ts";

describe("capture states", () => {
  test("every lamp position is covered", () => {
    const sides = new Set(CAPTURE_STATES.map((s) => s.side));
    for (const side of ["bottom", "top", "left", "right"]) {
      assert.ok(sides.has(side as never), `no capture state puts the lamp at the ${side}`);
    }
  });

  test("ids are unique and reachable by id", () => {
    const ids = CAPTURE_STATES.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, "two capture states share an id");
    for (const state of CAPTURE_STATES) {
      assert.deepEqual(captureStateById(state.id), state);
    }
    assert.equal(captureStateById("no-such-state"), null);
    assert.equal(captureStateById(undefined), null);
  });

  // The label tells whoever is holding the device which edge to look at. Derive
  // it and the two cannot disagree; state it and they can, silently.
  test("each state's stated side is where that seat renders", () => {
    for (const state of CAPTURE_STATES) {
      assert.equal(
        seatDirection(state.turn, CAPTURE_VIEWER_SEAT, state.playerCount),
        state.side,
        `${state.id} says ${state.side}`
      );
    }
  });
});

describe("the state a capture renders", () => {
  test("deals the whole deck, once", () => {
    for (const state of CAPTURE_STATES) {
      const game = captureGameState(state);
      const ids = [
        ...game.players.flatMap((p) => p.hand.map((c) => c.id)),
        ...(game.lastPlayedCombination?.cards.map((c) => c.id) ?? []),
      ];
      assert.equal(new Set(ids).size, ids.length, `${state.id} deals a card twice`);
      assert.equal(ids.length, createDeck().length, `${state.id} loses a card`);
    }
  });

  test("puts the turn where the state asked", () => {
    for (const state of CAPTURE_STATES) {
      assert.equal(captureGameState(state).currentTurnIndex, state.turn, state.id);
    }
  });

  test("a pile state draws a combination, played by somebody other than the seat on move", () => {
    for (const state of CAPTURE_STATES) {
      const game = captureGameState(state);
      if (!state.pile) {
        assert.equal(game.lastPlayedCombination, null, `${state.id} put a pile on the felt`);
        assert.equal(game.lastPlayedBy, -1, state.id);
        continue;
      }
      assert.ok(game.lastPlayedCombination, `${state.id} asked for a pile and got none`);
      assert.notEqual(game.lastPlayedBy, state.turn, `${state.id} plays against itself`);
      assert.ok(game.lastPlayedBy >= 0, state.id);
    }
  });

  test("nothing waits on the opening, so the table draws mid-hand", () => {
    for (const state of CAPTURE_STATES) {
      const game = captureGameState(state);
      assert.equal(game.firstPlayMade, true, state.id);
      assert.equal(game.gameOver, false, state.id);
      assert.equal(game.startCard, undefined, state.id);
    }
  });

  test("the swing walks every seat and comes back", () => {
    const game = captureGameState(CAPTURE_STATES[0]);
    const seats = new Set<number>();
    let turn = game.currentTurnIndex;
    for (let i = 0; i < game.players.length; i++) {
      seats.add(turn);
      turn = nextTurn({ ...game, currentTurnIndex: turn });
    }
    assert.equal(seats.size, game.players.length, "the swing skips a seat");
    assert.equal(turn, game.currentTurnIndex, "the swing does not return to where it started");
  });
});
