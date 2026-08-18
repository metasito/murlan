import { test, describe } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore — see tests/helpers.ts
import {
  MATCH_TARGETS,
  targetsFor,
  addHandScores,
  botWantsRematch,
  CLOSING_HAND_CARDS,
  isMajority,
  matchIsClosing,
  nextMatchTarget,
  resolveMatch,
  resolveTeamMatch,
  scoreHand,
} from "./helpers.ts";

describe("scoreHand", () => {
  test("4 players award 3/2/1/0", () => {
    assert.deepEqual(scoreHand(["a", "b", "c", "d"], 4), { a: 3, b: 2, c: 1, d: 0 });
  });

  test("generalises to 3 and 2 players", () => {
    assert.deepEqual(scoreHand(["a", "b", "c"], 3), { a: 2, b: 1, c: 0 });
    assert.deepEqual(scoreHand(["a", "b"], 2), { a: 1, b: 0 });
  });

  test("never awards negative points if the rankings run long", () => {
    const scores = scoreHand(["a", "b", "c", "d", "e"], 4);
    assert.equal(scores.e, 0);
    assert.ok(Object.values(scores).every((v) => v >= 0));
  });

  test("an empty ranking scores nobody", () => {
    assert.deepEqual(scoreHand([], 4), {});
  });
});

describe("addHandScores", () => {
  test("accumulates without mutating the input", () => {
    const cumulative = { a: 5, b: 2 };
    const merged = addHandScores(cumulative, { a: 3, c: 1 });
    assert.deepEqual(merged, { a: 8, b: 2, c: 1 });
    assert.deepEqual(cumulative, { a: 5, b: 2 });
  });
});

describe("MATCH_TARGETS / nextMatchTarget", () => {
  test("targets escalate 21 → 31 → 41 → 51", () => {
    assert.deepEqual([...MATCH_TARGETS], [21, 31, 41, 51]);
    assert.equal(nextMatchTarget(21), 31);
    assert.equal(nextMatchTarget(31), 41);
    assert.equal(nextMatchTarget(41), 51);
    assert.equal(nextMatchTarget(51), null);
  });

  test("the ladder scales with the seat count", () => {
    assert.deepEqual(targetsFor(2), [7, 10, 14, 17]);
    assert.deepEqual(targetsFor(3), [14, 21, 27, 34]);
    assert.deepEqual(targetsFor(4), [21, 31, 41, 51]);
  });

  test("the four-player ladder is byte-identical to the constant", () => {
    assert.deepEqual(targetsFor(4), [...MATCH_TARGETS]);
  });

  test("escalation still chains for every seat count", () => {
    for (const playerCount of [2, 3, 4]) {
      const ladder = targetsFor(playerCount);
      for (let i = 0; i < ladder.length - 1; i++) {
        assert.equal(
          nextMatchTarget(ladder[i], playerCount),
          ladder[i + 1],
          `${playerCount}p: ${ladder[i]} → ${ladder[i + 1]}`
        );
      }
      assert.equal(nextMatchTarget(ladder[ladder.length - 1], playerCount), null);
    }
  });
});

describe("resolveMatch", () => {
  test("nobody at the target: the match continues", () => {
    assert.equal(resolveMatch({ a: 20, b: 18, c: 3, d: 0 }, 21), null);
  });

  test("one player at the target wins the match", () => {
    assert.deepEqual(resolveMatch({ a: 21, b: 18 }, 21), {
      winners: ["a"],
      newTarget: null,
      isDraw: false,
    });
  });

  test("overshooting the target still wins", () => {
    assert.deepEqual(resolveMatch({ a: 24, b: 18 }, 21), {
      winners: ["a"],
      newTarget: null,
      isDraw: false,
    });
  });

  test("two players at the target escalate to 31", () => {
    assert.deepEqual(resolveMatch({ a: 22, b: 21, c: 5 }, 21), {
      winners: [],
      newTarget: 31,
      isDraw: false,
    });
  });

  test("escalation chains 31 → 41 → 51", () => {
    assert.equal(resolveMatch({ a: 32, b: 31 }, 31)?.newTarget, 41);
    assert.equal(resolveMatch({ a: 42, b: 41 }, 41)?.newTarget, 51);
  });

  test("a tie at the final target is a draw between the leaders", () => {
    const result = resolveMatch({ a: 53, b: 53, c: 51, d: 10 }, 51);
    assert.equal(result?.isDraw, true);
    assert.equal(result?.newTarget, null);
    assert.deepEqual(result?.winners.sort(), ["a", "b"]);
  });

  test("a clear leader at the final target is a win, not a draw", () => {
    assert.deepEqual(resolveMatch({ a: 53, b: 51 }, 51), {
      winners: ["a"],
      newTarget: null,
      isDraw: false,
    });
  });

  test("a team ahead at the final target wins with both partners named", () => {
    const teamOfKey = { a: "A", c: "A", b: "B", d: "B" };
    const result = resolveTeamMatch({ a: 28, c: 25, b: 26, d: 25 }, teamOfKey, 51);
    assert.equal(result?.isDraw, false);
    assert.equal(result?.newTarget, null);
    assert.deepEqual(result?.winners.sort(), ["a", "c"]);
  });

  test("a single player reaching 51 still wins outright", () => {
    assert.deepEqual(resolveMatch({ a: 51, b: 40 }, 51), {
      winners: ["a"],
      newTarget: null,
      isDraw: false,
    });
  });

  test("a match at any seat count finishes in a sitting", () => {
    // docs/BRIEF.md §3.1: the ladder exists so a match lands in roughly 8-12
    // manches at every count. A flat 21 made a 1-v-1 take ~27.
    for (const playerCount of [2, 3, 4]) {
      const players = ["a", "b", "c", "d"].slice(0, playerCount);
      let cumulative: Record<string, number> = {};
      let target = targetsFor(playerCount)[0];
      let manches = 0;
      let finished = false;

      while (manches < 12 && !finished) {
        // One seat wins every manche: the shortest possible match, and the
        // one that has to fit inside the band.
        cumulative = addHandScores(cumulative, scoreHand(players, playerCount));
        manches++;
        const result = resolveMatch(cumulative, target, playerCount);
        if (!result) continue;
        if (result.newTarget !== null) {
          target = result.newTarget;
          continue;
        }
        finished = true;
      }

      assert.ok(
        finished,
        `${playerCount} players: no winner after ${manches} manches`
      );
    }
  });

  test("a full 4-player match plays out to a single winner", () => {
    const players = ["a", "b", "c", "d"];
    let cumulative: Record<string, number> = {};
    let target = MATCH_TARGETS[0];
    let winner: string | null = null;

    for (let hand = 0; hand < 40 && !winner; hand++) {
      // Rotate the finishing order so "a" wins slightly more often.
      const rankings = hand % 3 === 0 ? players : [...players.slice(1), players[0]];
      cumulative = addHandScores(cumulative, scoreHand(rankings, players.length));
      const result = resolveMatch(cumulative, target);
      if (!result) continue;
      if (result.newTarget !== null) {
        target = result.newTarget;
        continue;
      }
      assert.equal(result.isDraw, false);
      assert.equal(result.winners.length, 1);
      winner = result.winners[0];
    }

    assert.ok(winner, "the match must terminate with a winner");
    assert.ok(cumulative[winner!] >= 21);
  });
});

describe("the rematch decision", () => {
  describe("isMajority", () => {
    test("a table split down the middle stops", () => {
      assert.equal(isMajority(1, 2), false);
      assert.equal(isMajority(2, 4), false);
    });

    test("both must say yes at two seats", () => {
      assert.equal(isMajority(0, 2), false);
      assert.equal(isMajority(2, 2), true);
    });

    test("three and four seats need two and three", () => {
      assert.equal(isMajority(1, 3), false);
      assert.equal(isMajority(2, 3), true);
      assert.equal(isMajority(2, 4), false);
      assert.equal(isMajority(3, 4), true);
    });

    test("nobody answering is never a majority", () => {
      for (const seats of [2, 3, 4]) assert.equal(isMajority(0, seats), false);
    });
  });

  describe("botWantsRematch", () => {
    test("a leader on nothing means the game has not started pulling apart", () => {
      assert.equal(botWantsRematch(0, 0), true);
    });

    test("a bot at exactly half the leader still wants another", () => {
      assert.equal(botWantsRematch(6, 12), true);
    });

    test("a thoroughly beaten bot does not", () => {
      assert.equal(botWantsRematch(5, 12), false);
    });
  });

  describe("matchIsClosing", () => {
    const base = {
      length: "match" as const,
      target: 21,
      cumulative: { a: 19 },
      handCounts: [3, 8, 9],
      playerCount: 4,
    };

    test("the closing threshold is five cards in the shortest hand", () => {
      assert.equal(CLOSING_HAND_CARDS, 5);
      assert.equal(matchIsClosing({ ...base, handCounts: [6, 8, 9] }), false);
      assert.equal(matchIsClosing({ ...base, handCounts: [5, 8, 9] }), true);
    });

    test("a single manche is always its own last one", () => {
      assert.equal(matchIsClosing({ ...base, length: "single", cumulative: {} }), true);
    });

    test("an empty table is never closing", () => {
      assert.equal(matchIsClosing({ ...base, handCounts: [] }), false);
    });

    test("a leader who cannot reach the target from this manche is not closing", () => {
      assert.equal(matchIsClosing({ ...base, cumulative: { a: 17 } }), false);
      assert.equal(matchIsClosing({ ...base, cumulative: { a: 18 } }), true);
    });

    test("the reach it allows for is the top per-manche award", () => {
      // `playerCount - 1` inside matchIsClosing is an unwritten restatement of
      // scoreHand's best prize. Change the point table and the prompt appears
      // a manche early or never appears at all.
      for (const playerCount of [2, 3, 4]) {
        const seats = ["a", "b", "c", "d"].slice(0, playerCount);
        const best = Math.max(...Object.values(scoreHand(seats, playerCount)));
        assert.equal(playerCount - 1, best);
        assert.equal(
          matchIsClosing({ ...base, playerCount, cumulative: { a: 21 - best } }),
          true
        );
        assert.equal(
          matchIsClosing({ ...base, playerCount, cumulative: { a: 20 - best } }),
          false
        );
      }
    });
  });
});
