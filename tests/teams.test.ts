// tests/teams.test.ts — teams mode is scored as a *pair* (docs/RULES.md §11,
// BRIEF §3.1): the two partners' placement points are summed and the pair
// races to 21. Two invariants are pinned here:
//
//  1. the match must resolve on the pair's combined placement points, not
//     per seat — a pair holding 20 + 1 has won, and both partners must be
//     reported as winners even though only one of them crossed the line;
//  2. the hand must not end until every seat has a placement — ending it the
//     instant both partners of one team are out would leave the losing pair
//     with no placement at all: no points, and (because the stats writer
//     skips anyone absent from `rankings`) no game recorded.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore — see tests/helpers.ts
import {
  aggregateTeamScores,
  buildCombination,
  foldHandIntoMatch,
  processPlay,
  resolveMatch,
  resolveTeamMatch,
  scoreHand,
  c,
  makePlayer,
  makeState,
} from "./helpers.ts";

/**
 * Seats 0/2 are team A, seats 1/3 are team B (partners sit opposite).
 * `handSizes` is how many cards each seat still holds.
 */
function teamsState(handSizes: number[], overrides = {}) {
  const ranks = ["4", "5", "6", "7", "8", "9", "10"] as const;
  const suits = ["spades", "hearts", "diamonds", "clubs"] as const;
  const players = handSizes.map((n, seat) =>
    makePlayer(
      `player_${seat}`,
      Array.from({ length: n }, (_, i) => c(ranks[i % ranks.length], suits[seat])),
      { team: seat % 2 === 0 ? "A" : "B" }
    )
  );
  return makeState(players, { gameMode: "teams", ...overrides });
}

describe("teams: every seat gets a placement", () => {
  test("the losing pair takes the remaining positions when a team goes out", () => {
    // Seat 0 (team A) already finished first; seat 2 (its partner) is about to
    // finish, which ends the hand with seats 1 and 3 still holding cards.
    const state = teamsState([0, 3, 1, 5], {
      currentTurnIndex: 2,
      rankings: ["player_0"],
      firstPlayMade: true,
      lastPlayedCombination: null,
    });
    state.players[0].finishPosition = 1;

    const combo = buildCombination(state.players[2].hand);
    assert.ok(combo, "the single remaining card must form a valid play");
    const next = processPlay(state, combo!);

    assert.equal(next.gameOver, true);
    // Nobody is left without a placement — this is what stats/history read.
    assert.equal(next.rankings.length, 4);
    assert.deepEqual(next.rankings, [
      "player_0",
      "player_2",
      "player_1", // 3 cards left — closer to finishing than seat 3
      "player_3", // 5 cards left
    ]);
    assert.deepEqual(
      next.players.map((p: { finishPosition?: number }) => p.finishPosition),
      [1, 3, 2, 4]
    );
  });

  test("the losing pair is awarded its placement points", () => {
    const state = teamsState([0, 3, 1, 5], {
      currentTurnIndex: 2,
      rankings: ["player_0"],
      firstPlayMade: true,
    });
    state.players[0].finishPosition = 1;
    const next = processPlay(state, buildCombination(state.players[2].hand)!);

    const points = scoreHand(next.rankings, 4);
    // 1st = 3, 2nd = 2, 3rd = 1, last = 0 — the losing pair scores 1, not
    // nothing at all.
    assert.deepEqual(points, {
      player_0: 3,
      player_2: 2,
      player_1: 1,
      player_3: 0,
    });
    const teamA = points.player_0 + points.player_2;
    const teamB = points.player_1 + points.player_3;
    assert.equal(teamA, 5);
    assert.equal(teamB, 1);
  });

  test("a hand ending with only one seat left over still places it", () => {
    // Seats 0 and 1 out already; seat 2 (team A) finishes, completing team A
    // and leaving only seat 3.
    const state = teamsState([0, 0, 1, 4], {
      currentTurnIndex: 2,
      rankings: ["player_0", "player_1"],
      firstPlayMade: true,
    });
    state.players[0].finishPosition = 1;
    state.players[1].finishPosition = 2;
    const next = processPlay(state, buildCombination(state.players[2].hand)!);

    assert.equal(next.gameOver, true);
    assert.deepEqual(next.rankings, ["player_0", "player_1", "player_2", "player_3"]);
  });

  test("a seat finishing after the whole opposing pair is out ends the hand", () => {
    // Seats 1 and 3 (team B) are both out and seat 0 finishes without its own
    // partner having finished, so `teammateDone` is false — the configuration
    // the hand-end disjunct exists for, and one nothing played through.
    //
    // The disjunct does not decide it on its own: at four seats a pair being
    // wholly out leaves at most one seat holding cards, so the activePlayers
    // check below reaches the same end. Deleting the disjunct leaves this
    // green.
    const state = teamsState([1, 0, 4, 0], {
      currentTurnIndex: 0,
      rankings: ["player_1", "player_3"],
      firstPlayMade: true,
    });
    state.players[1].finishPosition = 1;
    state.players[3].finishPosition = 2;

    const next = processPlay(state, buildCombination(state.players[0].hand)!);

    assert.equal(next.gameOver, true);
    assert.deepEqual(next.rankings, ["player_1", "player_3", "player_0", "player_2"]);
    assert.equal(next.players[2].finishPosition, 4, "the last seat is still placed");
  });
});

describe("teams: the match resolves on the summed team total", () => {
  const teamOfKey = { u0: "A", u2: "A", u1: "B", u3: "B" };

  test("partners' points are summed", () => {
    assert.deepEqual(
      aggregateTeamScores({ u0: 12, u2: 9, u1: 4, u3: 3 }, teamOfKey),
      { A: 21, B: 7 }
    );
  });

  test("a pair on 20 + 1 has reached 21 even though no seat has", () => {
    const cumulative = { u0: 20, u2: 1, u1: 5, u3: 2 };
    // Per-seat resolution — the old behaviour — sees nobody at the target.
    assert.equal(resolveMatch(cumulative, 21), null);

    const resolution = resolveTeamMatch(cumulative, teamOfKey, 21);
    assert.ok(resolution);
    assert.equal(resolution!.newTarget, null);
    assert.equal(resolution!.isDraw, false);
    // BOTH partners are winners: the one who scored the 20 and the one who
    // scored the 1. Only naming the first denied the other its achievements.
    assert.deepEqual(resolution!.winners.sort(), ["u0", "u2"]);
  });

  test("both partners are reported when one of them crosses alone", () => {
    const resolution = resolveTeamMatch(
      { u0: 21, u2: 0, u1: 5, u3: 5 },
      teamOfKey,
      21
    );
    assert.ok(resolution);
    // The server sets GameResult.matchWon from `matchWinners.includes(key)`.
    const matchWon = (key: string) => resolution!.winners.includes(key);
    assert.equal(matchWon("u0"), true);
    assert.equal(matchWon("u2"), true, "the partner must also win the match");
    assert.equal(matchWon("u1"), false);
    assert.equal(matchWon("u3"), false);
  });

  test("both pairs reaching the target escalates instead of declaring a winner", () => {
    const resolution = resolveTeamMatch(
      { u0: 11, u2: 11, u1: 12, u3: 10 },
      teamOfKey,
      21
    );
    assert.ok(resolution);
    assert.equal(resolution!.newTarget, 31);
    assert.deepEqual(resolution!.winners, []);
  });

  test("a tie at the final target is a draw, naming both pairs' members", () => {
    const resolution = resolveTeamMatch(
      { u0: 30, u2: 21, u1: 30, u3: 21 },
      teamOfKey,
      51
    );
    assert.ok(resolution);
    assert.equal(resolution!.isDraw, true);
    assert.deepEqual(resolution!.winners.sort(), ["u0", "u1", "u2", "u3"]);
  });

  test("a below-target pair does not end the match", () => {
    assert.equal(
      resolveTeamMatch({ u0: 10, u2: 10, u1: 9, u3: 1 }, teamOfKey, 21),
      null
    );
  });

  test("keys with no team (vacated bot seats) contribute nothing", () => {
    // Only the seated humans appear in teamOfKey; a `bot:1` score must not
    // push team B anywhere.
    const resolution = resolveTeamMatch(
      { u0: 11, u2: 10, "bot:1": 40 },
      { u0: "A", u2: "A" },
      21
    );
    assert.ok(resolution);
    assert.deepEqual(resolution!.winners.sort(), ["u0", "u2"]);
  });
});

// Seats 0/2 are team A, 1/3 team B. `foldHandIntoMatch` is where the pair
// rule meets match progression: both authorities call it, so a partner
// crossing the line alone has to name the pair on either side of the wire.
describe("teams: folding a manche into the match", () => {
  const teamOf = { player_0: "A", player_1: "B", player_2: "A", player_3: "B" };
  const base = {
    playerCount: 4,
    gameMode: "teams" as const,
    length: "match" as const,
    target: 21,
    teamOf,
    keyOf: (engineId: string) => engineId,
  };

  test("the pair's summed total ends the match and names both partners", () => {
    const result = foldHandIntoMatch({
      ...base,
      rankings: ["player_0", "player_1", "player_2", "player_3"],
      cumulative: { player_0: 15, player_2: 2, player_1: 9, player_3: 8 },
    });
    assert.equal(result.over, true);
    assert.deepEqual(result.winners.sort(), ["player_0", "player_2"]);
    assert.equal(result.isDraw, false);
  });

  test("a single manche is taken by the pair, not the seat that emptied first", () => {
    const result = foldHandIntoMatch({
      ...base,
      length: "single",
      rankings: ["player_1", "player_0", "player_2", "player_3"],
      cumulative: {},
    });
    assert.equal(result.over, true);
    assert.deepEqual(result.winners.sort(), ["player_1", "player_3"]);
  });

  describe("with a partner who walked out", () => {
    // The server's keys: seat 3 is vacated, so team B is one human and a
    // `bot:3` sentinel that must stay out of the pair's total and out of its
    // winners.
    const seatOf: Record<string, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };
    const playerMap: Record<number, string> = { 0: "u0", 1: "u1", 2: "u2" };
    const online = {
      playerCount: 4,
      gameMode: "teams" as const,
      length: "match" as const,
      target: 21,
      teamOf: { p0: "A", p1: "B", p2: "A", p3: "B" },
      keyOf: (engineId: string) => {
        const seat = seatOf[engineId];
        return seat === undefined ? null : (playerMap[seat] ?? `bot:${seat}`);
      },
      accumulates: (key: string) => !key.startsWith("bot:"),
    };

    test("the vacated seat contributes nothing to its pair's total", () => {
      const result = foldHandIntoMatch({
        ...online,
        rankings: ["p3", "p1", "p0", "p2"],
        cumulative: { u0: 9, u2: 8, u1: 12, "bot:3": 30 },
      });
      // Team B is u1 alone on 12 + 2 = 14; the sentinel's 30 is not theirs.
      assert.equal(result.over, false);
      assert.deepEqual(result.winners, []);
    });

    test("the pair wins on its human's points alone, and only they are named", () => {
      const result = foldHandIntoMatch({
        ...online,
        rankings: ["p1", "p0", "p2", "p3"],
        cumulative: { u0: 9, u2: 8, u1: 19 },
      });
      assert.equal(result.over, true);
      assert.deepEqual(result.winners, ["u1"]);
    });
  });
});
