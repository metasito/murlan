import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  MATCH_TARGETS,
  targetsFor,
  foldRound,
  placementPoints,
  scoreRound,
  type GameMode,
  type MatchLength,
  type SeatScoring,
} from "../../lib/game/gameEngine.ts";
import { seatScoringOf } from "../../server/game/onlineGameLogic.ts";
import { seat as makePlayer, state as makeState } from "../support/game.ts";

/** Seats that each score under their own id, every one of them crownable. */
const seatsFor = (ids: string[], teamOf: Record<string, "A" | "B"> = {}): SeatScoring[] =>
  ids.map((id) => ({ engineId: id, key: id, team: teamOf[id], crownable: true }));

/** Where the match stands on `cumulative` alone: a round nobody finished, folded in. */
const standing = (
  cumulative: Record<string, number>,
  target: number,
  opts: { playerCount?: number; gameMode?: GameMode; seats?: SeatScoring[] } = {}
) =>
  foldRound(
    {
      finishingOrder: [],
      playerCount: opts.playerCount ?? 4,
      gameMode: opts.gameMode ?? "free_for_all",
      length: "match",
    },
    { cumulative, target },
    opts.seats ?? seatsFor(Object.keys(cumulative))
  );

describe("placementPoints", () => {
  test("is read by 0-based finish index", () => {
    assert.deepEqual([0, 1, 2, 3].map((i) => placementPoints(i, 4)), [3, 2, 1, 0]);
    assert.deepEqual([0, 1].map((i) => placementPoints(i, 2)), [1, 0]);
  });

  test("never goes negative past the last seat", () => {
    assert.equal(placementPoints(4, 4), 0);
  });
});

describe("scoreRound", () => {
  test("4 players award 3/2/1/0", () => {
    assert.deepEqual(scoreRound(["a", "b", "c", "d"], 4), { a: 3, b: 2, c: 1, d: 0 });
  });

  test("generalises to 3 and 2 players", () => {
    assert.deepEqual(scoreRound(["a", "b", "c"], 3), { a: 2, b: 1, c: 0 });
    assert.deepEqual(scoreRound(["a", "b"], 2), { a: 1, b: 0 });
  });

  test("never awards negative points if the finishingOrder run long", () => {
    const scores = scoreRound(["a", "b", "c", "d", "e"], 4);
    assert.equal(scores.e, 0);
    assert.ok(Object.values(scores).every((v) => v >= 0));
  });

  test("an empty finishing order scores nobody", () => {
    assert.deepEqual(scoreRound([], 4), {});
  });
});

describe("accumulating a round", () => {
  test("adds onto the running totals without mutating them", () => {
    const cumulative = { a: 5, b: 2 };
    const result = foldRound(
      { finishingOrder: ["a", "d", "c"], playerCount: 4, gameMode: "free_for_all", length: "match" },
      { cumulative, target: 21 },
      seatsFor(["a", "b", "c", "d"])
    );
    assert.deepEqual(result.cumulative, { a: 8, b: 2, d: 2, c: 1 });
    assert.deepEqual(cumulative, { a: 5, b: 2 });
  });
});

describe("MATCH_TARGETS / escalation", () => {
  test("targets escalate 21 → 31 → 41 → 51", () => {
    assert.deepEqual([...MATCH_TARGETS], [21, 31, 41, 51]);
    assert.equal(standing({ a: 21, b: 21 }, 21).target, 31);
    assert.equal(standing({ a: 31, b: 31 }, 31).target, 41);
    assert.equal(standing({ a: 41, b: 41 }, 41).target, 51);
    const final = standing({ a: 51, b: 51 }, 51);
    assert.equal(final.target, 51);
    assert.equal(final.over, true);
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
        const result = standing({ a: ladder[i], b: ladder[i] }, ladder[i], { playerCount });
        assert.equal(result.target, ladder[i + 1], `${playerCount}p: ${ladder[i]} → ${ladder[i + 1]}`);
        assert.equal(result.over, false);
      }
      const last = ladder[ladder.length - 1];
      const final = standing({ a: last, b: last }, last, { playerCount });
      assert.equal(final.target, last);
      assert.equal(final.over, true);
    }
  });
});

describe("resolving the match", () => {
  test("nobody at the target: the match continues", () => {
    const result = standing({ a: 20, b: 18, c: 3, d: 0 }, 21);
    assert.equal(result.over, false);
    assert.equal(result.target, 21);
    assert.deepEqual(result.winners, []);
  });

  test("one player at the target wins the match", () => {
    const result = standing({ a: 21, b: 18 }, 21);
    assert.deepEqual([result.over, result.winners, result.isDraw], [true, ["a"], false]);
  });

  test("overshooting the target still wins", () => {
    const result = standing({ a: 24, b: 18 }, 21);
    assert.deepEqual([result.over, result.winners, result.isDraw], [true, ["a"], false]);
  });

  test("two players at the target escalate to 31", () => {
    const result = standing({ a: 22, b: 21, c: 5 }, 21);
    assert.deepEqual([result.over, result.target, result.winners, result.isDraw], [false, 31, [], false]);
  });

  test("escalation chains 31 → 41 → 51", () => {
    assert.equal(standing({ a: 32, b: 31 }, 31).target, 41);
    assert.equal(standing({ a: 42, b: 41 }, 41).target, 51);
  });

  test("a tie at the final target is a draw between the leaders", () => {
    const result = standing({ a: 53, b: 53, c: 51, d: 10 }, 51);
    assert.equal(result.isDraw, true);
    assert.equal(result.over, true);
    assert.equal(result.target, 51);
    assert.deepEqual(result.winners.sort(), ["a", "b"]);
  });

  test("a clear leader at the final target is a win, not a draw", () => {
    const result = standing({ a: 53, b: 51 }, 51);
    assert.deepEqual([result.over, result.winners, result.isDraw], [true, ["a"], false]);
  });

  test("a team ahead at the final target wins with both partners named", () => {
    const result = standing({ a: 28, c: 25, b: 26, d: 25 }, 51, {
      gameMode: "teams",
      seats: seatsFor(["a", "b", "c", "d"], { a: "A", c: "A", b: "B", d: "B" }),
    });
    assert.equal(result.isDraw, false);
    assert.equal(result.over, true);
    assert.deepEqual(result.winners.sort(), ["a", "c"]);
  });

  test("a single player reaching 51 still wins outright", () => {
    const result = standing({ a: 51, b: 40 }, 51);
    assert.deepEqual([result.over, result.winners, result.isDraw], [true, ["a"], false]);
  });

  test("a match at any seat count finishes in a sitting", () => {
    // docs/GAME-RULES.md § Decisions: the ladder exists so a match lands in roughly 8-12
    // rounds at every count. A flat 21 made a 1-v-1 take ~27.
    for (const playerCount of [2, 3, 4]) {
      const players = ["a", "b", "c", "d"].slice(0, playerCount);
      let cumulative: Record<string, number> = {};
      let target = targetsFor(playerCount)[0];
      let rounds = 0;
      let finished = false;

      while (rounds < 12 && !finished) {
        // One seat wins every round: the shortest possible match, and the
        // one that has to fit inside the band.
        const result = foldRound(
          { finishingOrder: players, playerCount, gameMode: "free_for_all", length: "match" },
          { cumulative, target },
          seatsFor(players)
        );
        rounds++;
        cumulative = result.cumulative;
        target = result.target;
        finished = result.over;
      }

      assert.ok(finished, `${playerCount} players: no winner after ${rounds} rounds`);
    }
  });

  test("a full 4-player match plays out to a single winner", () => {
    const players = ["a", "b", "c", "d"];
    let cumulative: Record<string, number> = {};
    let target = MATCH_TARGETS[0];
    let winner: string | null = null;

    for (let round = 0; round < 40 && !winner; round++) {
      // Rotate the finishing order so "a" wins slightly more often.
      const finishingOrder = round % 3 === 0 ? players : [...players.slice(1), players[0]];
      const result = foldRound(
        { finishingOrder, playerCount: players.length, gameMode: "free_for_all", length: "match" },
        { cumulative, target },
        seatsFor(players)
      );
      cumulative = result.cumulative;
      target = result.target;
      if (!result.over) continue;
      assert.equal(result.isDraw, false);
      assert.equal(result.winners.length, 1);
      winner = result.winners[0];
    }

    assert.ok(winner, "the match must terminate with a winner");
    assert.ok(cumulative[winner!] >= 21);
  });
});

// `foldRound` is the one match progression both authorities run: offline keys by engine player id,
// the server by userId or the `bot:<seat>` sentinel for a seat someone left.
describe("foldRound", () => {
  const ffaMatch = { playerCount: 4, length: "match" as const, gameMode: "free_for_all" as const };
  const abcd = seatsFor(["a", "b", "c", "d"]);

  test("below the target: points accumulate, the target stands, nobody wins", () => {
    const result = foldRound(
      { ...ffaMatch, finishingOrder: ["a", "b", "c", "d"] },
      { cumulative: { a: 5, b: 2, c: 1, d: 0 }, target: 21 },
      abcd
    );
    assert.deepEqual(result.roundByKey, { a: 3, b: 2, c: 1, d: 0 });
    assert.deepEqual(result.cumulative, { a: 8, b: 4, c: 2, d: 0 });
    assert.equal(result.target, 21);
    assert.equal(result.over, false);
    assert.deepEqual(result.winners, []);
    assert.equal(result.isDraw, false);
  });

  test("the sole seat reaching the target wins the match", () => {
    const result = foldRound(
      { ...ffaMatch, finishingOrder: ["a", "b", "c", "d"] },
      { cumulative: { a: 19, b: 4, c: 2, d: 0 }, target: 21 },
      abcd
    );
    assert.equal(result.over, true);
    assert.deepEqual(result.winners, ["a"]);
    assert.equal(result.isDraw, false);
  });

  test("two seats reaching it together escalate instead of ending it", () => {
    const result = foldRound(
      { ...ffaMatch, finishingOrder: ["a", "b", "c", "d"] },
      { cumulative: { a: 19, b: 19, c: 2, d: 0 }, target: 21 },
      abcd
    );
    assert.equal(result.over, false);
    assert.equal(result.target, 31);
    assert.deepEqual(result.winners, []);
  });

  test("a tie at the final target is a draw naming everyone on it", () => {
    const result = foldRound(
      { ...ffaMatch, finishingOrder: ["a", "b", "c", "d"] },
      { cumulative: { a: 49, b: 50, c: 2, d: 0 }, target: 51 },
      abcd
    );
    assert.equal(result.over, true);
    assert.equal(result.isDraw, true);
    assert.deepEqual(result.winners.sort(), ["a", "b"]);
  });

  test("does not mutate the cumulative totals it was handed", () => {
    const cumulative = { a: 5, b: 2 };
    foldRound({ ...ffaMatch, finishingOrder: ["a", "b"] }, { cumulative, target: 21 }, abcd);
    assert.deepEqual(cumulative, { a: 5, b: 2 });
  });

  describe("a single round", () => {
    const single = { ...ffaMatch, length: "single" as const };

    test("ends the match on whoever took it, with no target involved", () => {
      const result = foldRound(
        { ...single, finishingOrder: ["c", "a", "d", "b"] },
        { cumulative: {}, target: 21 },
        abcd
      );
      assert.equal(result.over, true);
      assert.deepEqual(result.winners, ["c"]);
      assert.equal(result.target, 21);
      assert.equal(result.isDraw, false);
    });

    test("a round nobody finished names no winner", () => {
      const result = foldRound({ ...single, finishingOrder: [] }, { cumulative: {}, target: 21 }, abcd);
      assert.equal(result.over, true);
      assert.deepEqual(result.winners, []);
    });
  });

  describe("seats that may not be crowned (vacated seats)", () => {
    // Seat 1 was walked out of, so it scores under `bot:1`. Reachable end to end only through
    // tests/integration/*, which need a live Postgres — this is the same rule at the unit.
    const online = (teamOf: Record<string, "A" | "B"> = {}): SeatScoring[] => [
      { engineId: "p0", key: "u0", team: teamOf.p0, crownable: true },
      { engineId: "p1", key: "bot:1", team: teamOf.p1, crownable: false },
      { engineId: "p2", key: "u2", team: teamOf.p2, crownable: true },
      { engineId: "p3", key: "u3", team: teamOf.p3, crownable: true },
    ];

    test("a vacated seat's points land on both the round and the match scoreboard", () => {
      const result = foldRound(
        { ...ffaMatch, finishingOrder: ["p1", "p0", "p2", "p3"] },
        { cumulative: { u0: 4, u2: 2, u3: 1 }, target: 21 },
        online()
      );
      assert.deepEqual(result.roundByKey, { "bot:1": 3, u0: 2, u2: 1, u3: 0 });
      assert.deepEqual(result.cumulative, { "bot:1": 3, u0: 6, u2: 3, u3: 1 });
    });

    test("a vacated seat cannot cross the target or be named the winner", () => {
      const result = foldRound(
        { ...ffaMatch, finishingOrder: ["p1", "p0", "p2", "p3"] },
        { cumulative: { u0: 4, u2: 2, u3: 1, "bot:1": 20 }, target: 21 },
        online()
      );
      assert.equal(result.over, false);
      assert.deepEqual(result.winners, []);
      // Its total sits past `target`: `over`/`winners` above are what prove the gate holds.
      assert.equal(result.cumulative["bot:1"], 23);
    });

    test("a vacated seat that takes a single round names the best seat behind it", () => {
      const result = foldRound(
        { ...ffaMatch, length: "single", finishingOrder: ["p1", "p0", "p2", "p3"] },
        { cumulative: {}, target: 21 },
        online()
      );
      assert.deepEqual(result.winners, ["u0"]);
    });

    test("a single round every seat walked out of names nobody", () => {
      const result = foldRound(
        { ...ffaMatch, length: "single", finishingOrder: ["p1", "p0", "p2", "p3"] },
        { cumulative: {}, target: 21 },
        [0, 1, 2, 3].map((seat) => ({ engineId: `p${seat}`, key: `bot:${seat}`, crownable: false }))
      );
      assert.equal(result.over, true);
      assert.deepEqual(result.winners, []);
    });

    test("a single round in teams names the vacated winner's partner, not the other team", () => {
      // docs/GAME-RULES.md §11: the team takes the round, not the seat that
      // emptied its hand — so the pair that took it still wins.
      const result = foldRound(
        { ...ffaMatch, length: "single", gameMode: "teams", finishingOrder: ["p1", "p3", "p0", "p2"] },
        { cumulative: {}, target: 21 },
        online({ p0: "B", p1: "A", p2: "B", p3: "A" })
      );
      assert.deepEqual(result.winners, ["u3"]);
    });

    test("an engine id belonging to no seat is dropped entirely", () => {
      const result = foldRound(
        { ...ffaMatch, finishingOrder: ["ghost", "p0", "p2", "p3"] },
        { cumulative: {}, target: 21 },
        online()
      );
      assert.deepEqual(result.roundByKey, { u0: 2, u2: 1, u3: 0 });
      assert.deepEqual(result.cumulative, { u0: 2, u2: 1, u3: 0 });
    });

    test("a row no seat lists is never crowned", () => {
      const result = foldRound(
        { ...ffaMatch, finishingOrder: ["p0", "p2", "p3", "p1"] },
        { cumulative: { gone: 30, u0: 2 }, target: 21 },
        online()
      );
      assert.equal(result.over, false);
      assert.deepEqual(result.winners, []);
    });
  });

  describe("both authorities fold the same round the same way", () => {
    // Offline keys by engine player id and the server by userId, so one round run through both
    // seat descriptions must come out differing by nothing but the keys.
    const userOf: Record<string, string> = {
      player_0: "u0",
      player_1: "u1",
      player_2: "u2",
      player_3: "u3",
    };
    const rekey = (scores: Record<string, number>) =>
      Object.fromEntries(Object.entries(scores).map(([id, points]) => [userOf[id], points]));

    const agree = (args: {
      finishingOrder: string[];
      length: MatchLength;
      gameMode: GameMode;
      target: number;
      cumulative: Record<string, number>;
      teamOf?: Record<string, "A" | "B">;
    }) => {
      const round = {
        finishingOrder: args.finishingOrder,
        playerCount: 4,
        gameMode: args.gameMode,
        length: args.length,
      };
      const ids = Object.keys(userOf);
      const offline = foldRound(round, { cumulative: args.cumulative, target: args.target }, seatsFor(ids, args.teamOf));
      const online = foldRound(
        round,
        { cumulative: rekey(args.cumulative), target: args.target },
        ids.map((id) => ({ engineId: id, key: userOf[id], team: args.teamOf?.[id], crownable: true }))
      );
      assert.deepEqual(
        {
          ...offline,
          roundByKey: rekey(offline.roundByKey),
          cumulative: rekey(offline.cumulative),
          winners: offline.winners.map((id) => userOf[id]),
        },
        online
      );
      return online;
    };

    const finishingOrder = ["player_2", "player_0", "player_3", "player_1"];
    const teamOf = { player_0: "A", player_1: "B", player_2: "A", player_3: "B" } as const;

    test("free-for-all, below the target", () => {
      agree({
        finishingOrder,
        length: "match",
        gameMode: "free_for_all",
        target: 21,
        cumulative: { player_0: 4, player_2: 2 },
      });
    });

    test("free-for-all, a seat crossing the target", () => {
      const result = agree({
        finishingOrder,
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
        finishingOrder,
        length: "match",
        gameMode: "free_for_all",
        target: 21,
        cumulative: { player_0: 19, player_1: 21, player_2: 19, player_3: 2 },
      });
      assert.equal(result.target, 31);
    });

    test("teams, a pair crossing the target", () => {
      const result = agree({
        finishingOrder,
        length: "match",
        gameMode: "teams",
        target: 21,
        cumulative: { player_0: 10, player_1: 3, player_2: 9, player_3: 2 },
        teamOf,
      });
      assert.equal(result.over, true);
      assert.deepEqual(result.winners.sort(), ["u0", "u2"]);
    });

    test("a single round, in both modes", () => {
      agree({ finishingOrder, length: "single", gameMode: "free_for_all", target: 21, cumulative: {} });
      agree({ finishingOrder, length: "single", gameMode: "teams", target: 21, cumulative: {}, teamOf });
    });
  });
});


// Every outcome the server's scoring reaches, as literals: a change to how seats are described to
// the fold has to reproduce each one.
describe("the fold matrix", () => {
  type Scenario = {
    playerMap: Record<number, string>;
    botSeatsAtStart: number[];
    vacatedSeats: Record<number, string>;
    finishingOrder: string[];
    cumulative: Record<string, number>;
    target: number;
  };
  const scenarios: Record<string, Scenario> = {
    vacated: {
      playerMap: { 0: "u0", 2: "u2", 3: "u3" },
      botSeatsAtStart: [],
      vacatedSeats: {},
      finishingOrder: ["player_1", "player_0", "player_2", "player_3"],
      cumulative: { u0: 17, u2: 9, u3: 4, "bot:1": 20 },
      target: 21,
    },
    "frozen partner": {
      playerMap: { 0: "u0", 2: "u2", 3: "u3" },
      botSeatsAtStart: [],
      vacatedSeats: { 1: "u1" },
      finishingOrder: ["player_1", "player_3", "player_0", "player_2"],
      cumulative: { u0: 6, u2: 5, u3: 8, u1: 9, "bot:1": 2 },
      target: 21,
    },
    "born bot": {
      playerMap: { 0: "u0", 2: "u2", 3: "u3" },
      botSeatsAtStart: [1],
      vacatedSeats: {},
      finishingOrder: ["player_1", "player_0", "player_2", "player_3"],
      cumulative: { u0: 10, u2: 4, u3: 3, "bot:1": 18 },
      target: 21,
    },
    "tie at target": {
      playerMap: { 0: "u0", 1: "u1", 2: "u2", 3: "u3" },
      botSeatsAtStart: [],
      vacatedSeats: {},
      finishingOrder: ["player_0", "player_1", "player_2", "player_3"],
      cumulative: { u0: 18, u1: 19, u2: 8, u3: 9 },
      target: 21,
    },
    "tie at final rung": {
      playerMap: { 0: "u0", 1: "u1", 2: "u2", 3: "u3" },
      botSeatsAtStart: [],
      vacatedSeats: {},
      finishingOrder: ["player_0", "player_1", "player_2", "player_3"],
      cumulative: { u0: 48, u1: 49, u2: 40, u3: 41 },
      target: 51,
    },
  };

  const totals: Record<string, Record<string, number>> = {
    vacated: { u0: 19, u2: 10, u3: 4, "bot:1": 23 },
    "frozen partner": { u0: 7, u2: 5, u3: 10, u1: 9, "bot:1": 5 },
    "born bot": { u0: 12, u2: 5, u3: 3, "bot:1": 21 },
    "tie at target": { u0: 21, u1: 21, u2: 9, u3: 9 },
    "tie at final rung": { u0: 51, u1: 51, u2: 41, u3: 41 },
  };
  type Outcome = { target: number; over: boolean; winners: string[]; isDraw: boolean };
  const expected: Record<"free_for_all" | "teams", Record<"match" | "single", Record<string, Outcome>>> = {
    free_for_all: {
      match: {
        vacated: { target: 21, over: false, winners: [], isDraw: false },
        "frozen partner": { target: 21, over: false, winners: [], isDraw: false },
        "born bot": { target: 21, over: true, winners: ["bot:1"], isDraw: false },
        "tie at target": { target: 31, over: false, winners: [], isDraw: false },
        "tie at final rung": { target: 51, over: true, winners: ["u0", "u1"], isDraw: true },
      },
      single: {
        vacated: { target: 21, over: true, winners: ["u0"], isDraw: false },
        "frozen partner": { target: 21, over: true, winners: ["u3"], isDraw: false },
        "born bot": { target: 21, over: true, winners: ["bot:1"], isDraw: false },
        "tie at target": { target: 21, over: true, winners: ["u0"], isDraw: false },
        "tie at final rung": { target: 51, over: true, winners: ["u0"], isDraw: false },
      },
    },
    teams: {
      match: {
        vacated: { target: 31, over: false, winners: [], isDraw: false },
        "frozen partner": { target: 21, over: true, winners: ["u3"], isDraw: false },
        "born bot": { target: 21, over: true, winners: ["bot:1", "u3"], isDraw: false },
        "tie at target": { target: 31, over: false, winners: [], isDraw: false },
        "tie at final rung": { target: 51, over: true, winners: ["u0", "u1", "u2", "u3"], isDraw: true },
      },
      single: {
        vacated: { target: 21, over: true, winners: ["u0", "u2", "u3"], isDraw: true },
        "frozen partner": { target: 21, over: true, winners: ["u3"], isDraw: false },
        "born bot": { target: 21, over: true, winners: ["u0", "bot:1", "u2", "u3"], isDraw: true },
        "tie at target": { target: 21, over: true, winners: ["u0", "u2"], isDraw: false },
        "tie at final rung": { target: 51, over: true, winners: ["u0", "u2"], isDraw: false },
      },
    },
  };

  const fold = (gameMode: GameMode, length: MatchLength, s: Scenario) => {
    const state = makeState({
      gameMode,
      finishingOrder: s.finishingOrder,
      players: [0, 1, 2, 3].map((seat) =>
        makePlayer(seat, [], {
          id: `player_${seat}`,
          team: gameMode === "teams" ? (seat % 2 === 0 ? "A" : "B") : undefined,
        })
      ),
    });
    const vacatedSeats = new Map(
      Object.entries(s.vacatedSeats).map(([seat, userId]) => [Number(seat), { userId, username: userId }])
    );
    return foldRound(
      { finishingOrder: s.finishingOrder, playerCount: 4, gameMode, length },
      { cumulative: s.cumulative, target: s.target },
      seatScoringOf({ state, playerMap: s.playerMap, botSeatsAtStart: new Set(s.botSeatsAtStart), vacatedSeats })
    );
  };

  for (const gameMode of ["free_for_all", "teams"] as const) {
    for (const length of ["match", "single"] as const) {
      for (const [name, outcome] of Object.entries(expected[gameMode][length])) {
        test(`${gameMode}, ${length}, ${name}`, () => {
          const result = fold(gameMode, length, scenarios[name]);
          assert.deepEqual(
            { target: result.target, over: result.over, winners: result.winners, isDraw: result.isDraw },
            outcome
          );
          assert.deepEqual(result.cumulative, totals[name]);
        });
      }
    }
  }
});
