// tests/engine/teams.test.ts — teams mode is scored as a *team* (docs/GAME-RULES.md §11,
// BRIEF §3.1): the two partners' placement points are summed and the team
// races to 21. Two invariants are pinned here:
//
//  1. the match must resolve on the team's combined placement points, not
//     per seat — a team holding 20 + 1 has won, and both partners must be
//     reported as winners even though only one of them crossed the line;
//  2. the round is played out (docs/GAME-RULES.md §9, § Decisions "Teams win
//     condition"): a team going out does not end it, and every seat is placed
//     by the order it emptied its hand — the stats writer skips anyone absent
//     from `finishingOrder`, and the exchange reads who came last.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { card as c, seat as makePlayer, state as makeState } from "../support/game.ts";
import {
  aggregateTeamScores,
  buildCombination,
  foldRound,
  processPlay,
  scoreRound,
  type GameMode,
  type MatchLength,
  type SeatScoring,
} from "../../lib/game/gameEngine.ts";

/**
 * Seats 0/2 are team A, seats 1/3 are team B (partners sit opposite).
 * `handSizes` is how many cards each seat still holds.
 */
function teamsState(handSizes: number[], overrides = {}) {
  const ranks = ["4", "5", "6", "7", "8", "9", "10"] as const;
  const suits = ["spades", "hearts", "diamonds", "clubs"] as const;
  const players = handSizes.map((n, seat) =>
    makePlayer(
      seat,
      Array.from({ length: n }, (_, i) => c(ranks[i % ranks.length], suits[seat])),
      { team: seat % 2 === 0 ? "A" : "B" }
    )
  );
  return makeState({ players, gameMode: "teams", ...overrides });
}

describe("teams: every seat gets a placement", () => {
  // Seat 0 (team A) already finished first; seat 2 (its partner) is about to
  // finish, leaving seats 1 and 3 holding 3 and 5 cards.
  const pairGoesOut = () => {
    const state = teamsState([0, 3, 1, 5], {
      currentTurnIndex: 2,
      finishingOrder: ["p0"],
      firstPlayMade: true,
      lastPlayedCombination: null,
    });
    state.players[0].finishPosition = 1;
    return processPlay(state, buildCombination(state.players[2].hand)!);
  };

  test("the losing pair plays on after both partners of the other pair are out", () => {
    const next = pairGoesOut();

    assert.equal(next.roundOver, false);
    assert.deepEqual(next.finishingOrder, ["p0", "p2"]);
    assert.equal(next.players[1].finishPosition, undefined);
    assert.equal(next.players[3].finishPosition, undefined);
    assert.ok([1, 3].includes(next.currentTurnIndex), "a seat still holding cards is on move");
  });

  test("the losing pair is placed by the order it empties, not by cards left", () => {
    const next = pairGoesOut();
    next.players[3].hand = next.players[3].hand.slice(0, 1);
    next.currentTurnIndex = 3;
    next.lastPlayedCombination = null;
    const done = processPlay(next, buildCombination(next.players[3].hand)!);

    assert.equal(done.roundOver, true);
    assert.deepEqual(done.finishingOrder, ["p0", "p2", "p3", "p1"]);
    assert.equal(done.players[1].finishPosition, 4, "the seat still holding cards is last");

    const points = scoreRound(done.finishingOrder, 4);
    assert.deepEqual(points, {
      p0: 3,
      p2: 2,
      p3: 1,
      p1: 0,
    });
    const teamA = points.p0 + points.p2;
    const teamB = points.p1 + points.p3;
    assert.equal(teamA, 5);
    assert.equal(teamB, 1);
  });

  test("a round ending with only one seat left over still places it", () => {
    // Seats 0 and 1 out already; seat 2 (team A) finishes, completing team A
    // and leaving only seat 3.
    const state = teamsState([0, 0, 1, 4], {
      currentTurnIndex: 2,
      finishingOrder: ["p0", "p1"],
      firstPlayMade: true,
    });
    state.players[0].finishPosition = 1;
    state.players[1].finishPosition = 2;
    const next = processPlay(state, buildCombination(state.players[2].hand)!);

    assert.equal(next.roundOver, true);
    assert.deepEqual(next.finishingOrder, ["p0", "p1", "p2", "p3"]);
  });
});

describe("teams: the match resolves on the summed team total", () => {
  const teamOfKey = { u0: "A", u2: "A", u1: "B", u3: "B" } as const;
  const teamSeats: SeatScoring[] = Object.entries(teamOfKey).map(([key, team]) => ({
    engineId: key,
    key,
    team,
    crownable: true,
  }));
  /** Where the match stands on `cumulative` alone: a round nobody finished, folded in. */
  const standing = (
    cumulative: Record<string, number>,
    target: number,
    gameMode: GameMode = "teams",
    seats: SeatScoring[] = teamSeats
  ) =>
    foldRound(
      { finishingOrder: [], playerCount: 4, gameMode, length: "match" },
      { cumulative, target },
      seats
    );

  test("partners' points are summed", () => {
    assert.deepEqual(
      aggregateTeamScores({ u0: 12, u2: 9, u1: 4, u3: 3 }, teamOfKey),
      { A: 21, B: 7 }
    );
  });

  test("a pair on 20 + 1 has reached 21 even though no seat has", () => {
    const cumulative = { u0: 20, u2: 1, u1: 5, u3: 2 };
    // Per-seat resolution — the old behaviour — sees nobody at the target.
    assert.equal(standing(cumulative, 21, "free_for_all").over, false);

    const result = standing(cumulative, 21);
    assert.equal(result.over, true);
    assert.equal(result.isDraw, false);
    // BOTH partners are winners: the one who scored the 20 and the one who
    // scored the 1. Only naming the first denied the other its achievements.
    assert.deepEqual(result.winners.sort(), ["u0", "u2"]);
  });

  test("both partners are reported when one of them crosses alone", () => {
    const result = standing({ u0: 21, u2: 0, u1: 5, u3: 5 }, 21);
    assert.equal(result.over, true);
    // The server sets GameResult.matchWon from `matchWinners.includes(key)`.
    const matchWon = (key: string) => result.winners.includes(key);
    assert.equal(matchWon("u0"), true);
    assert.equal(matchWon("u2"), true, "the partner must also win the match");
    assert.equal(matchWon("u1"), false);
    assert.equal(matchWon("u3"), false);
  });

  test("both pairs reaching the target escalates instead of declaring a winner", () => {
    const result = standing({ u0: 11, u2: 11, u1: 12, u3: 10 }, 21);
    assert.equal(result.over, false);
    assert.equal(result.target, 31);
    assert.deepEqual(result.winners, []);
  });

  test("a tie at the final target is a draw, naming both pairs' members", () => {
    const result = standing({ u0: 30, u2: 21, u1: 30, u3: 21 }, 51);
    assert.equal(result.over, true);
    assert.equal(result.isDraw, true);
    assert.deepEqual(result.winners.sort(), ["u0", "u1", "u2", "u3"]);
  });

  test("a below-target pair does not end the match", () => {
    const result = standing({ u0: 10, u2: 10, u1: 9, u3: 1 }, 21);
    assert.equal(result.over, false);
    assert.equal(result.target, 21);
  });

  test("keys with no team (vacated bot seats) contribute nothing", () => {
    // Only the seated humans carry a team; a `bot:1` score must not push team B anywhere.
    const result = standing({ u0: 11, u2: 10, "bot:1": 40 }, 21, "teams", [
      { engineId: "u0", key: "u0", team: "A", crownable: true },
      { engineId: "u2", key: "u2", team: "A", crownable: true },
    ]);
    assert.equal(result.over, true);
    assert.deepEqual(result.winners.sort(), ["u0", "u2"]);
  });
});

// Seats 0/2 are team A, 1/3 team B. `foldRound` is where the team rule meets match progression:
// both authorities call it, so a partner crossing the line alone has to name the team on either
// side of the wire.
describe("teams: folding a round into the match", () => {
  const teamOf = { p0: "A", p1: "B", p2: "A", p3: "B" } as const;
  const seats: SeatScoring[] = Object.entries(teamOf).map(([id, team]) => ({
    engineId: id,
    key: id,
    team,
    crownable: true,
  }));
  const fold = (length: MatchLength, finishingOrder: string[], cumulative: Record<string, number>) =>
    foldRound({ finishingOrder, playerCount: 4, gameMode: "teams", length }, { cumulative, target: 21 }, seats);

  test("the pair's summed total ends the match and names both partners", () => {
    const result = fold("match", ["p0", "p1", "p2", "p3"], { p0: 15, p2: 2, p1: 9, p3: 8 });
    assert.equal(result.over, true);
    assert.deepEqual(result.winners.sort(), ["p0", "p2"]);
    assert.equal(result.isDraw, false);
  });

  test("a single round is taken by the pair, not the seat that emptied first", () => {
    const result = fold("single", ["p1", "p3", "p0", "p2"], {});
    assert.equal(result.over, true);
    assert.equal(result.isDraw, false);
    assert.deepEqual(result.winners.sort(), ["p1", "p3"]);
  });

  test("a single round paying both teams 3 is a draw, whoever emptied first", () => {
    const result = fold("single", ["p1", "p0", "p2", "p3"], {});
    assert.equal(result.over, true);
    assert.equal(result.isDraw, true);
    assert.deepEqual(result.winners.sort(), ["p0", "p1", "p2", "p3"]);
  });

  describe("with a partner who walked out", () => {
    // The server's own shape: seat 3 scores as `bot:3`, which is never crowned, and `u3`'s frozen
    // row is the points seat 3 won before leaving.
    const online: SeatScoring[] = [
      { engineId: "p0", key: "u0", team: "A", crownable: true },
      { engineId: "p1", key: "u1", team: "B", crownable: true },
      { engineId: "p2", key: "u2", team: "A", crownable: true },
      { engineId: "p3", key: "bot:3", team: "B", crownable: false, frozenKey: "u3" },
    ];
    const foldOnline = (finishingOrder: string[], cumulative: Record<string, number>) =>
      foldRound(
        { finishingOrder, playerCount: 4, gameMode: "teams", length: "match" },
        { cumulative, target: 21 },
        online
      );

    test("the team keeps the departed partner's points, frozen", () => {
      const result = foldOnline(["p3", "p1", "p0", "p2"], { u0: 9, u2: 8, u1: 12, u3: 6, "bot:3": 1 });
      // Team B: u1 on 12 + 2, u3's frozen 6, and the takeover's own 1 + 3 = 24.
      assert.equal(result.over, true);
      assert.deepEqual(result.winners, ["u1"], "only the partner still there is named");
    });

    test("short of the target, the pair plays on", () => {
      const result = foldOnline(["p1", "p0", "p2", "p3"], { u0: 9, u2: 8, u1: 12, u3: 4 });
      // Team B: u1 on 12 + 3, plus u3's frozen 4 = 19.
      assert.equal(result.over, false);
      assert.deepEqual(result.winners, []);
    });
  });
});
