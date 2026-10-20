// Which turn the table is on, and who has passed in it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { comboKey, passedSeats, seatsJustPassed, trickClosedWithWinner, turnKey } from "../../components/passes.ts";
import { card as c, seat as makePlayer, state as makeState } from "../support/game.ts";
import {
  buildCombination,
  processPass,
  processPlay,
  type GameState,
  type Player,
} from "../../lib/game/gameEngine.ts";

const combo = (ids: string[]): any => ({
  type: "single",
  strength: 1,
  cards: ids.map((id) => ({ id })),
});


/** Four seats, all still holding cards. */
const ALL_IN = [false, false, false, false];

describe("comboKey", () => {
  test("the same cards played by different seats are different plays", () => {
    assert.notEqual(comboKey(combo(["a", "b"]), 0), comboKey(combo(["a", "b"]), 1));
  });

  test("the same play produces a stable key", () => {
    assert.equal(comboKey(combo(["a", "b"]), 2), comboKey(combo(["a", "b"]), 2));
  });
});

describe("turnKey", () => {
  const turn = { currentTurnIndex: 1, passCount: 0, lastPlayedCombination: combo(["a"]), lastPlayedBy: 0 };

  test("a pass is a new turn", () => {
    assert.notEqual(turnKey(turn), turnKey({ ...turn, currentTurnIndex: 2, passCount: 1 }));
  });

  test("the trick's winner leading on an empty table is a new turn", () => {
    const lastToPlay = { ...turn, currentTurnIndex: 0, passCount: 0 };
    const won = { ...lastToPlay, lastPlayedCombination: null };
    assert.equal(turnKey(won), "0|0|-");
    assert.notEqual(turnKey(won), turnKey(lastToPlay));
  });

  test("the same state is the same turn", () => {
    assert.equal(turnKey(turn), turnKey({ ...turn }));
  });
});

describe("trickClosedWithWinner", () => {
  test("the closing pass — the table is empty and a seat took it", () => {
    assert.equal(
      trickClosedWithWinner({ lastPlayedCombination: null, trickWinner: 2 }),
      true
    );
  });

  test("seat 0 counts, which a truthiness check would miss", () => {
    assert.equal(
      trickClosedWithWinner({ lastPlayedCombination: null, trickWinner: 0 }),
      true
    );
  });

  test("a round in progress has not closed, whoever won the last one", () => {
    assert.equal(
      trickClosedWithWinner({ lastPlayedCombination: combo(["a"]), trickWinner: 1 }),
      false
    );
  });

  test("a pass that does not close the round leaves nobody credited", () => {
    assert.equal(
      trickClosedWithWinner({ lastPlayedCombination: combo(["a"]), trickWinner: null }),
      false
    );
  });

  test("a freshly dealt hand is empty but nothing has been won", () => {
    assert.equal(
      trickClosedWithWinner({ lastPlayedCombination: null, trickWinner: null }),
      false
    );
    assert.equal(trickClosedWithWinner({ lastPlayedCombination: null }), false);
  });
});

describe("passedSeats", () => {
  test("nobody has answered yet — the turn is with the seat right after the play", () => {
    assert.deepEqual(
      passedSeats({
        currentTurnIndex: 2,
        lastPlayedBy: 3,
        lastPlayedCombination: combo(["a"]),
        outOfCards: ALL_IN,
      }),
      []
    );
  });

  test("one seat passed", () => {
    assert.deepEqual(
      passedSeats({
        currentTurnIndex: 1,
        lastPlayedBy: 3,
        lastPlayedCombination: combo(["a"]),
        outOfCards: ALL_IN,
      }),
      [2]
    );
  });

  test("two seats passed, in the order they passed", () => {
    assert.deepEqual(
      passedSeats({
        currentTurnIndex: 0,
        lastPlayedBy: 3,
        lastPlayedCombination: combo(["a"]),
        outOfCards: ALL_IN,
      }),
      [2, 1]
    );
  });

  test("the walk wraps past seat 0", () => {
    assert.deepEqual(
      passedSeats({
        currentTurnIndex: 2,
        lastPlayedBy: 1,
        lastPlayedCombination: combo(["a"]),
        outOfCards: ALL_IN,
      }),
      [0, 3]
    );
  });

  test("a seat that has gone out is stepped over, not marked", () => {
    // Seat 2 emptied its hand in an earlier round, so the turn went 3 → 1.
    // Marking it would claim it answered a round it is not in.
    assert.deepEqual(
      passedSeats({
        currentTurnIndex: 1,
        lastPlayedBy: 3,
        lastPlayedCombination: combo(["a"]),
        outOfCards: [false, false, true, false],
      }),
      []
    );
  });

  test("a seat that has gone out does not stop the walk short", () => {
    assert.deepEqual(
      passedSeats({
        currentTurnIndex: 0,
        lastPlayedBy: 3,
        lastPlayedCombination: combo(["a"]),
        outOfCards: [false, false, true, false],
      }),
      [1]
    );
  });

  test("between rounds nothing is marked", () => {
    // `processPass` clears the combination on the pass that closes the round,
    // which is the moment every marker must go.
    assert.deepEqual(
      passedSeats({
        currentTurnIndex: 3,
        lastPlayedBy: 3,
        lastPlayedCombination: null,
        outOfCards: ALL_IN,
      }),
      []
    );
  });

  test("a freshly dealt hand, whose lastPlayedBy names no seat", () => {
    assert.deepEqual(
      passedSeats({
        currentTurnIndex: 0,
        lastPlayedBy: -1,
        lastPlayedCombination: combo(["a"]),
        outOfCards: ALL_IN,
      }),
      []
    );
    assert.deepEqual(
      passedSeats({
        currentTurnIndex: 0,
        lastPlayedBy: 9,
        lastPlayedCombination: combo(["a"]),
        outOfCards: ALL_IN,
      }),
      []
    );
  });

  test("heads-up: the only other seat is the one on move, so it has not passed", () => {
    assert.deepEqual(
      passedSeats({
        currentTurnIndex: 0,
        lastPlayedBy: 1,
        lastPlayedCombination: combo(["a"]),
        outOfCards: [false, false],
      }),
      []
    );
  });
});

describe("passedSeats walks the direction the engine deals turns", () => {
  // Against real transitions, not a hand-built state: `getNextActivePlayer`
  // moves to the *previous* seat index, and a marker on the wrong seat is
  // worse than no marker. Everything below comes out of the engine itself.
  const hands = (): Player[] => [
    makePlayer(0, [c("5", "spades"), c("6", "spades")]),
    makePlayer(1, [c("7", "hearts"), c("8", "hearts")]),
    makePlayer(2, [c("9", "clubs"), c("10", "clubs")]),
    makePlayer(3, [c("J", "diamonds"), c("Q", "diamonds")]),
  ];

  const view = (s: GameState) => ({
    currentTurnIndex: s.currentTurnIndex,
    lastPlayedBy: s.lastPlayedBy,
    lastPlayedCombination: s.lastPlayedCombination,
    outOfCards: s.players.map((p) => p.hand.length === 0),
  });

  test("each pass marks the seat that made it, and the round close clears them", () => {
    let s = makeState({ players: hands(),
      currentTurnIndex: 3,
      lastPlayedBy: 3,
      firstPlayMade: true,
    });

    s = processPlay(s, buildCombination([c("J", "diamonds")])!);
    assert.equal(s.currentTurnIndex, 2, "the engine deals the next turn downward");
    assert.deepEqual(passedSeats(view(s)), []);

    s = processPass(s);
    assert.equal(s.currentTurnIndex, 1);
    assert.deepEqual(passedSeats(view(s)), [2]);

    s = processPass(s);
    assert.equal(s.currentTurnIndex, 0);
    assert.deepEqual(passedSeats(view(s)), [2, 1]);

    s = processPass(s);
    assert.equal(s.lastPlayedCombination, null, "the third pass closes the round");
    assert.deepEqual(passedSeats(view(s)), []);
  });

  test("a seat that goes out mid-round is never marked", () => {
    // Seat 2 holds one card: it answers seat 3's lead by playing it and is out.
    // A king, because the answer has to actually beat the jack led below.
    const players = hands();
    players[2].hand = [c("K", "clubs")];
    let s = makeState({ players,
      currentTurnIndex: 3,
      lastPlayedBy: 3,
      firstPlayMade: true,
    });

    s = processPlay(s, buildCombination([c("J", "diamonds")])!);
    s = processPlay(s, buildCombination([c("K", "clubs")])!);
    assert.equal(s.players[2].hand.length, 0);
    assert.equal(s.lastPlayedBy, 2);

    s = processPass(s);
    assert.deepEqual(passedSeats(view(s)), [1]);

    s = processPass(s);
    const marked = passedSeats(view(s));
    assert.ok(!marked.includes(2), "seat 2 played, it did not pass");
    assert.deepEqual(marked, [1, 0]);
  });

  test("the round ending on a play marks nobody", () => {
    // `processPlay` returns as soon as the round is decided, so the turn never
    // moves off the seat that went out: `currentTurnIndex === lastPlayedBy`
    // with a combination still on the table. Seat 2 has simply not been dealt
    // another turn — it did not pass.
    const players = hands();
    players[0].hand = [];
    players[0].finishPosition = 1;
    players[1].hand = [];
    players[1].finishPosition = 2;
    players[3].hand = [c("J", "diamonds")];
    let s = makeState({ players,
      currentTurnIndex: 3,
      lastPlayedBy: 3,
      firstPlayMade: true,
      finishingOrder: ["player_0", "player_1"],
    });

    s = processPlay(s, buildCombination([c("J", "diamonds")])!);
    assert.equal(s.roundOver, true);
    assert.equal(s.currentTurnIndex, s.lastPlayedBy);
    assert.notEqual(s.lastPlayedCombination, null);
    assert.deepEqual(passedSeats(view(s)), []);
  });
});


describe("seatsJustPassed", () => {
  const hands = (): Player[] =>
    (["5", "7", "9", "J"] as const).map((rank, i) => makePlayer(i, [c(rank, "spades"), c("3", "hearts")]));
  const view = (s: GameState) => ({
    currentTurnIndex: s.currentTurnIndex,
    lastPlayedBy: s.lastPlayedBy,
    lastPlayedCombination: s.lastPlayedCombination,
    trickWinner: s.trickWinner,
    outOfCards: s.players.map((p) => p.hand.length === 0),
  });

  test("each engine pass names the seat that made it, the one closing the round too; a play names nobody", () => {
    let s = makeState({ players: hands(), currentTurnIndex: 3, lastPlayedBy: 3, firstPlayMade: true });
    const step = (next: GameState) => {
      const passed = seatsJustPassed(view(s), view(next));
      s = next;
      return passed;
    };
    assert.deepEqual(step(processPlay(s, buildCombination([c("J", "spades")])!)), []);
    for (const seat of [2, 1, 0]) assert.deepEqual(step(processPass(s)), [seat], `seat ${seat}'s pass`);
    assert.equal(s.lastPlayedCombination, null, "the third pass closed the round");
    assert.deepEqual(seatsJustPassed(view(s), view(s)), [], "an unchanged state names nobody");
  });
});
