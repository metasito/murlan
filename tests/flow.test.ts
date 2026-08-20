import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildCombination,
  c,
  getAllValidPlays,
  initializeGame,
  makePlayer,
  makeState,
  processPass,
  processPlay,
  type Card,
} from "./helpers.ts";
import { seatDirection } from "../components/gameTableModel.ts";

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

describe("turn rotation", () => {
  const single = (rank: Parameters<typeof c>[0]): Card[] => [c(rank, "hearts")];

  test("the turn moves to the previous seat index", () => {
    let state = makeState(
      [
        makePlayer("p0", [...single("4"), c("5", "clubs")]),
        makePlayer("p1", [...single("6"), c("7", "clubs")]),
        makePlayer("p2", [...single("8"), c("9", "clubs")]),
        makePlayer("p3", [...single("10"), c("J", "clubs")]),
      ],
      { currentTurnIndex: 2, lastPlayedCombination: combo(single("3")), lastPlayedBy: 3 }
    );

    for (const expected of [1, 0, 3]) {
      state = processPass(state);
      assert.equal(state.currentTurnIndex, expected);
    }
  });

  test("it steps over a seat that has already gone out", () => {
    const state = processPass(
      makeState(
        [
          makePlayer("p0", single("4")),
          makePlayer("p1", [], { finishPosition: 1 }),
          makePlayer("p2", single("8")),
          makePlayer("p3", single("10")),
        ],
        {
          currentTurnIndex: 2,
          lastPlayedCombination: combo(single("3")),
          lastPlayedBy: 3,
          rankings: ["p1"],
        }
      )
    );
    assert.equal(state.currentTurnIndex, 0, "seat 1 is out, so the turn skips to seat 0");
  });

  test("a descending seat index is what renders clockwise", () => {
    // The engine's direction and the table's layout are decided in two
    // different modules, and the rules screen promises the player one thing
    // ("si gioca in senso orario"). Nothing pinned the two halves against
    // each other, so a flipped rotation would still render a coherent table.
    const expected: Record<number, string[]> = {
      2: ["bottom", "top"],
      3: ["bottom", "top", "right"],
      4: ["bottom", "left", "top", "right"],
    };
    for (const playerCount of [2, 3, 4]) {
      for (const viewer of Array.from({ length: playerCount }, (_, i) => i)) {
        const order = Array.from({ length: playerCount }, (_, step) =>
          seatDirection(((viewer - step) % playerCount + playerCount) % playerCount, viewer, playerCount)
        );
        assert.deepEqual(order, expected[playerCount], `${playerCount} seats, viewer ${viewer}`);
      }
    }
  });
});

describe("a 3-player game", () => {
  /**
   * Three seats is the count nothing plays through: the deal is pinned in
   * tests/deal.test.ts and stops there, and every driver elsewhere builds a
   * 4-seat table. The round-end threshold, the rotation and the finishing
   * order all read the seat count.
   */
  test("plays from the deal to game over with every card accounted for", () => {
    for (let game = 0; game < 25; game++) playOneOut();
  });

  function playOneOut() {
    const state0 = initializeGame(
      ["a", "b", "c"].map((name) => ({ name, type: "human" as const })),
      "free_for_all"
    );

    assert.deepEqual(state0.players.map((p) => p.hand.length), [18, 18, 18]);
    assert.ok(state0.startCard, "the opening deal names a start card");
    assert.ok(
      state0.players[state0.currentTurnIndex].hand.some((x) => x.id === state0.startCard!.id),
      "the seat on turn is the one holding the start card"
    );

    const dealt = new Set(state0.players.flatMap((p) => p.hand.map((x) => x.id)));
    assert.equal(dealt.size, 54, "the whole deck is dealt, exactly once each");

    let state = state0;
    let turns = 0;
    while (!state.gameOver && turns < 500) {
      turns++;
      const seat = state.currentTurnIndex;
      assert.ok(
        state.players[seat].hand.length > 0,
        `turn ${turns} landed on seat ${seat}, which has already gone out`
      );

      const isNewRound = state.lastPlayedCombination === null;
      const plays = getAllValidPlays(
        state.players[seat].hand,
        isNewRound ? null : state.lastPlayedCombination,
        isNewRound,
        state.firstPlayMade ? undefined : state.startCard
      );

      if (plays.length === 0) {
        assert.ok(!isNewRound, `seat ${seat} had no legal lead on turn ${turns}`);
        state = processPass(state);
        continue;
      }
      state = processPlay(state, plays[0]);

      const live = state.players.flatMap((p) => p.hand.map((x) => x.id));
      assert.equal(new Set(live).size, live.length, "a card was duplicated mid-game");
    }

    assert.ok(state.gameOver, `three seats did not finish in ${turns} turns`);
    assert.equal(state.rankings.length, 3, "every seat is placed");
    assert.equal(new Set(state.rankings).size, 3);
    assert.deepEqual(
      state.players.map((p) => p.finishPosition).sort(),
      [1, 2, 3]
    );
    assert.deepEqual(
      state.rankings,
      [...state.players].sort((x, y) => x.finishPosition! - y.finishPosition!).map((p) => p.id)
    );
  }
});
