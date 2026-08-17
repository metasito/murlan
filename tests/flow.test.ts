import { test, describe } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore — see tests/helpers.ts
import {
  buildCombination,
  c,
  makePlayer,
  makeState,
  processPass,
  processPlay,
  type Card,
} from "./helpers.ts";

const pair = (rank: Parameters<typeof c>[0]): Card[] => [c(rank, "hearts"), c(rank, "clubs")];
const combo = (cards: Card[]) => buildCombination(cards)!;

describe("processPlay", () => {
  test("removes the played cards, records the play and resets the pass count", () => {
    const state = makeState(
      [
        makePlayer("p0", [...pair("7"), c("K", "spades")]),
        makePlayer("p1", [c("9", "spades"), c("9", "hearts")]),
      ],
      { currentTurnIndex: 0, passCount: 1 }
    );
    const played = combo(pair("7"));
    const next = processPlay(state, played);

    assert.deepEqual(next.players[0].hand.map((card) => card.id), ["K_spades"]);
    assert.equal(next.passCount, 0);
    assert.equal(next.lastPlayedBy, 0);
    assert.equal(next.firstPlayMade, true);
    assert.equal(next.lastPlayedCombination?.type, "pair");
    assert.deepEqual(
      state.players[0].hand.length,
      3,
      "the input state must not be mutated"
    );
  });

  test("records the finishing order and ends the hand when one player is left", () => {
    const state = makeState(
      [
        makePlayer("p0", pair("7")),
        makePlayer("p1", [c("9", "spades"), c("9", "hearts")]),
      ],
      { currentTurnIndex: 0 }
    );
    const next = processPlay(state, combo(pair("7")));
    assert.equal(next.gameOver, true);
    assert.deepEqual(next.rankings, ["p0", "p1"]);
    assert.equal(next.players[0].finishPosition, 1);
    assert.equal(next.players[1].finishPosition, 2);
  });
});

describe("processPass — leader may not pass (defect 6)", () => {
  test("passing while leading a new round is refused and changes nothing", () => {
    const state = makeState(
      [makePlayer("p0", pair("7")), makePlayer("p1", pair("9"))],
      { currentTurnIndex: 0, lastPlayedCombination: null }
    );
    const next = processPass(state);
    assert.equal(next, state, "state is returned untouched");
    assert.equal(next.passCount, 0);
    assert.equal(next.currentTurnIndex, 0, "the turn does not move on");
  });

  test("passing after somebody has played is allowed", () => {
    const state = makeState(
      [
        makePlayer("p0", pair("7")),
        makePlayer("p1", pair("9")),
        makePlayer("p2", pair("J")),
      ],
      {
        currentTurnIndex: 1,
        lastPlayedBy: 0,
        lastPlayedCombination: combo(pair("5")),
      }
    );
    const next = processPass(state);
    assert.notEqual(next, state);
    assert.equal(next.passCount, 1);
  });
});

describe("processPass — round end threshold (defect 5)", () => {
  test("4 players, all still holding cards: the round closes on the third pass", () => {
    let state = makeState(
      [
        makePlayer("p0", pair("7")),
        makePlayer("p1", pair("9")),
        makePlayer("p2", pair("J")),
        makePlayer("p3", pair("Q")),
      ],
      {
        currentTurnIndex: 3,
        lastPlayedBy: 0,
        lastPlayedCombination: combo(pair("5")),
      }
    );

    state = processPass(state);
    assert.equal(state.roundWinner, null, "one pass does not end the round");
    state = processPass(state);
    assert.equal(state.roundWinner, null, "two passes do not end the round");
    state = processPass(state);
    assert.equal(state.roundWinner, 0, "the third pass hands the round to p0");
    assert.equal(state.lastPlayedCombination, null);
    assert.equal(state.passCount, 0);
    assert.equal(state.currentTurnIndex, 0, "the round winner leads next");
  });

  test("3 players still holding cards: the round closes on the second pass", () => {
    let state = makeState(
      [
        makePlayer("p0", pair("7")),
        makePlayer("p1", pair("9")),
        makePlayer("p2", pair("J")),
      ],
      {
        currentTurnIndex: 2,
        lastPlayedBy: 0,
        lastPlayedCombination: combo(pair("5")),
      }
    );
    state = processPass(state);
    assert.equal(state.roundWinner, null);
    state = processPass(state);
    assert.equal(state.roundWinner, 0);
  });

  test("2 players still holding cards: a single pass closes the round", () => {
    const state = processPass(
      makeState(
        [makePlayer("p0", pair("7")), makePlayer("p1", pair("9"))],
        {
          currentTurnIndex: 1,
          lastPlayedBy: 0,
          lastPlayedCombination: combo(pair("5")),
        }
      )
    );
    assert.equal(state.roundWinner, 0);
    assert.equal(state.currentTurnIndex, 0);
  });

  test("REGRESSION: the last opponent still gets to answer a player who went out", () => {
    // p0 played their final cards. p1 and p2 still hold cards, so BOTH must
    // pass before the round can close — the old threshold closed it after one.
    let state = makeState(
      [
        makePlayer("p0", [], { finishPosition: 1 }),
        makePlayer("p1", pair("9")),
        makePlayer("p2", pair("K")),
      ],
      {
        currentTurnIndex: 2,
        lastPlayedBy: 0,
        lastPlayedCombination: combo(pair("5")),
        rankings: ["p0"],
      }
    );

    state = processPass(state);
    assert.equal(
      state.roundWinner,
      null,
      "one pass must not close the round while another opponent can still answer"
    );
    assert.equal(state.passCount, 1);
    assert.notEqual(state.currentTurnIndex, 0, "the finished player never gets the turn");

    state = processPass(state);
    assert.equal(state.roundWinner, 0, "the second pass closes the round");
    assert.equal(state.lastPlayedCombination, null);
    assert.notEqual(
      state.currentTurnIndex,
      0,
      "the lead passes to an active player, not the one who went out"
    );
    assert.ok(state.players[state.currentTurnIndex].hand.length > 0);
  });

  test("last-player-out with 4 seats: all three remaining opponents must pass", () => {
    let state = makeState(
      [
        makePlayer("p0", [], { finishPosition: 1 }),
        makePlayer("p1", pair("9")),
        makePlayer("p2", pair("K")),
        makePlayer("p3", pair("Q")),
      ],
      {
        currentTurnIndex: 3,
        lastPlayedBy: 0,
        lastPlayedCombination: combo(pair("5")),
        rankings: ["p0"],
      }
    );
    state = processPass(state);
    assert.equal(state.roundWinner, null);
    state = processPass(state);
    assert.equal(state.roundWinner, null);
    state = processPass(state);
    assert.equal(state.roundWinner, 0);
  });

  test("a pass that does not close the round leaves the round winner unset", () => {
    const state = processPass(
      makeState(
        [
          makePlayer("p0", pair("7")),
          makePlayer("p1", pair("9")),
          makePlayer("p2", pair("J")),
        ],
        {
          currentTurnIndex: 2,
          lastPlayedBy: 0,
          lastPlayedCombination: combo(pair("5")),
          roundWinner: 1,
        }
      )
    );
    assert.equal(state.roundWinner, null);
  });
});
