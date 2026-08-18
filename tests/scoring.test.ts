import { test, describe } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore — see tests/helpers.ts
import {
  MATCH_TARGETS,
  targetsFor,
  addHandScores,
  botWantsRematch,
  CLOSING_HAND_CARDS,
  foldHandIntoMatch,
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

// `foldHandIntoMatch` is the one match progression both authorities run:
// offline keys by engine player id, the server by userId or the `bot:<seat>`
// sentinel for a seat someone left.
describe("foldHandIntoMatch", () => {
  const base = {
    playerCount: 4,
    length: "match" as const,
    gameMode: "free_for_all" as const,
    target: 21,
    keyOf: (engineId: string) => engineId,
  };

  test("below the target: points accumulate, the target stands, nobody wins", () => {
    const result = foldHandIntoMatch({
      ...base,
      rankings: ["a", "b", "c", "d"],
      cumulative: { a: 5, b: 2, c: 1, d: 0 },
    });
    assert.deepEqual(result.handByKey, { a: 3, b: 2, c: 1, d: 0 });
    assert.deepEqual(result.cumulative, { a: 8, b: 4, c: 2, d: 0 });
    assert.equal(result.target, 21);
    assert.equal(result.over, false);
    assert.deepEqual(result.winners, []);
    assert.equal(result.isDraw, false);
  });

  test("the sole seat reaching the target wins the match", () => {
    const result = foldHandIntoMatch({
      ...base,
      rankings: ["a", "b", "c", "d"],
      cumulative: { a: 19, b: 4, c: 2, d: 0 },
    });
    assert.equal(result.over, true);
    assert.deepEqual(result.winners, ["a"]);
    assert.equal(result.isDraw, false);
  });

  test("two seats reaching it together escalate instead of ending it", () => {
    const result = foldHandIntoMatch({
      ...base,
      rankings: ["a", "b", "c", "d"],
      cumulative: { a: 19, b: 19, c: 2, d: 0 },
    });
    assert.equal(result.over, false);
    assert.equal(result.target, 31);
    assert.deepEqual(result.winners, []);
  });

  test("a tie at the final target is a draw naming everyone on it", () => {
    const result = foldHandIntoMatch({
      ...base,
      target: 51,
      rankings: ["a", "b", "c", "d"],
      cumulative: { a: 49, b: 50, c: 2, d: 0 },
    });
    assert.equal(result.over, true);
    assert.equal(result.isDraw, true);
    assert.deepEqual(result.winners.sort(), ["a", "b"]);
  });

  test("does not mutate the cumulative totals it was handed", () => {
    const cumulative = { a: 5, b: 2 };
    foldHandIntoMatch({ ...base, rankings: ["a", "b"], cumulative });
    assert.deepEqual(cumulative, { a: 5, b: 2 });
  });

  describe("a single manche", () => {
    const single = { ...base, length: "single" as const };

    test("ends the match on whoever took it, with no target involved", () => {
      const result = foldHandIntoMatch({
        ...single,
        rankings: ["c", "a", "d", "b"],
        cumulative: {},
      });
      assert.equal(result.over, true);
      assert.deepEqual(result.winners, ["c"]);
      assert.equal(result.target, 21);
      assert.equal(result.isDraw, false);
    });

    test("a manche nobody finished names no winner", () => {
      const result = foldHandIntoMatch({ ...single, rankings: [], cumulative: {} });
      assert.equal(result.over, true);
      assert.deepEqual(result.winners, []);
    });
  });

  describe("keys the table does not accumulate (vacated seats)", () => {
    // The server's key function: seat 1 was walked out of, so it scores under
    // `bot:1`. Reachable end to end only through tests/integration/*, which
    // need a live Postgres — this is the same rule at the unit.
    const seatOf: Record<string, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };
    const playerMap: Record<number, string> = { 0: "u0", 2: "u2", 3: "u3" };
    const online = {
      playerCount: 4,
      length: "match" as const,
      gameMode: "free_for_all" as const,
      keyOf: (engineId: string) => {
        const seat = seatOf[engineId];
        return seat === undefined ? null : (playerMap[seat] ?? `bot:${seat}`);
      },
      accumulates: (key: string) => !key.startsWith("bot:"),
    };

    test("a vacated seat is on the hand's scoreboard but not in the match total", () => {
      const result = foldHandIntoMatch({
        ...online,
        target: 21,
        rankings: ["p1", "p0", "p2", "p3"],
        cumulative: { u0: 4, u2: 2, u3: 1 },
      });
      assert.deepEqual(result.handByKey, { "bot:1": 3, u0: 2, u2: 1, u3: 0 });
      assert.deepEqual(result.cumulative, { u0: 6, u2: 3, u3: 1 });
    });

    test("a vacated seat cannot cross the target or be named the winner", () => {
      const result = foldHandIntoMatch({
        ...online,
        target: 21,
        rankings: ["p1", "p0", "p2", "p3"],
        cumulative: { u0: 4, u2: 2, u3: 1, "bot:1": 20 },
      });
      assert.equal(result.over, false);
      assert.deepEqual(result.winners, []);
      // A sentinel total that predates the walkout is carried, never added to.
      assert.equal(result.cumulative["bot:1"], 20);
    });

    test("a vacated seat that takes a single manche is still named — it took it", () => {
      const result = foldHandIntoMatch({
        ...online,
        length: "single",
        target: 21,
        rankings: ["p1", "p0", "p2", "p3"],
        cumulative: {},
      });
      assert.deepEqual(result.winners, ["bot:1"]);
    });

    test("an engine id belonging to no seat is dropped entirely", () => {
      const result = foldHandIntoMatch({
        ...online,
        target: 21,
        rankings: ["ghost", "p0", "p2", "p3"],
        cumulative: {},
      });
      assert.deepEqual(result.handByKey, { u0: 2, u2: 1, u3: 0 });
      assert.deepEqual(result.cumulative, { u0: 2, u2: 1, u3: 0 });
    });
  });

  describe("both authorities fold the same hand the same way", () => {
    // The regression this function exists to prevent. Offline keys by engine
    // player id and the server by userId, so one hand run through both key
    // functions must come out differing by nothing but the keys.
    const userOf: Record<string, string> = {
      player_0: "u0",
      player_1: "u1",
      player_2: "u2",
      player_3: "u3",
    };
    const rekey = (scores: Record<string, number>) =>
      Object.fromEntries(Object.entries(scores).map(([id, points]) => [userOf[id], points]));

    const agree = (args: {
      rankings: string[];
      length: "match" | "single";
      gameMode: "free_for_all" | "teams";
      target: number;
      cumulative: Record<string, number>;
      teamOf?: Record<string, string>;
    }) => {
      const shared = {
        playerCount: 4,
        length: args.length,
        gameMode: args.gameMode,
        target: args.target,
        rankings: args.rankings,
        teamOf: args.teamOf,
      };
      const offline = foldHandIntoMatch({
        ...shared,
        cumulative: args.cumulative,
        keyOf: (engineId: string) => engineId,
      });
      const online = foldHandIntoMatch({
        ...shared,
        cumulative: rekey(args.cumulative),
        keyOf: (engineId: string) => userOf[engineId] ?? null,
        accumulates: (key: string) => !key.startsWith("bot:"),
      });
      assert.deepEqual(
        {
          ...offline,
          handByKey: rekey(offline.handByKey),
          cumulative: rekey(offline.cumulative),
          winners: offline.winners.map((id) => userOf[id]),
        },
        online
      );
      return online;
    };

    const rankings = ["player_2", "player_0", "player_3", "player_1"];
    const teamOf = { player_0: "A", player_1: "B", player_2: "A", player_3: "B" };

    test("free-for-all, below the target", () => {
      agree({
        rankings,
        length: "match",
        gameMode: "free_for_all",
        target: 21,
        cumulative: { player_0: 4, player_2: 2 },
      });
    });

    test("free-for-all, a seat crossing the target", () => {
      const result = agree({
        rankings,
        length: "match",
        gameMode: "free_for_all",
        target: 21,
        cumulative: { player_0: 19, player_1: 3, player_2: 10, player_3: 2 },
      });
      assert.equal(result.over, true);
      assert.deepEqual(result.winners, ["u0"]);
    });

    test("free-for-all, an escalation", () => {
      const result = agree({
        rankings,
        length: "match",
        gameMode: "free_for_all",
        target: 21,
        cumulative: { player_0: 19, player_1: 21, player_2: 19, player_3: 2 },
      });
      assert.equal(result.target, 31);
    });

    test("teams, a pair crossing the target", () => {
      const result = agree({
        rankings,
        length: "match",
        gameMode: "teams",
        target: 21,
        cumulative: { player_0: 10, player_1: 3, player_2: 9, player_3: 2 },
        teamOf,
      });
      assert.equal(result.over, true);
      assert.deepEqual(result.winners.sort(), ["u0", "u2"]);
    });

    test("a single manche, in both modes", () => {
      agree({ rankings, length: "single", gameMode: "free_for_all", target: 21, cumulative: {} });
      agree({ rankings, length: "single", gameMode: "teams", target: 21, cumulative: {}, teamOf });
    });
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
