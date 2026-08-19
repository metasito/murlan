import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  readPersistedPlayerMap,
  seatOfUser,
  scoreKeyForSeat,
  findViewerSeat,
  isBotSeatKey,
  buildSeatRoster,
  teamKeyMap,
  restoredMatchOver,
} from "../server/onlineGameLogic.ts";
import { teamForSeat, TEAMS_PLAYER_COUNT } from "../lib/gameEngine.ts";

describe("readPersistedPlayerMap (seat resolution on rejoin)", () => {
  test("reads the seat -> userId map", () => {
    const map = readPersistedPlayerMap({ "0": "alice", "2": "carol" });
    assert.deepEqual(map, { 0: "alice", 2: "carol" });
  });

  test("a non-contiguous seat map keeps its gaps", () => {
    // This is the exact corruption this function exists to prevent: a
    // rejoining player must land on their own seat, not a compacted index.
    const map = readPersistedPlayerMap({ "0": "alice", "3": "dan" });
    assert.deepEqual(map, { 0: "alice", 3: "dan" });
    assert.equal(seatOfUser(map, "dan"), 3);
  });

  test("ignores non-string values and non-integer keys in the map", () => {
    const map = readPersistedPlayerMap({ "0": "alice", "x": "bob", "1": 42 });
    assert.deepEqual(map, { 0: "alice" });
  });

  test("a missing or unreadable map resolves to an empty seating", () => {
    assert.deepEqual(readPersistedPlayerMap({}), {});
    assert.deepEqual(readPersistedPlayerMap(null), {});
    assert.deepEqual(readPersistedPlayerMap(["alice", "bob"]), {});
  });
});

describe("seatOfUser / findViewerSeat", () => {
  const playerMap = { 0: "alice", 1: "bob", 3: "dan" };

  test("finds the seat for a seated user", () => {
    assert.equal(seatOfUser(playerMap, "bob"), 1);
    assert.equal(seatOfUser(playerMap, "dan"), 3);
  });

  test("returns null — never 0 — for a user who isn't seated", () => {
    // This is the exact regression this guards: defaulting to 0 makes an
    // unseated/unknown viewer believe they are seat 0.
    assert.equal(seatOfUser(playerMap, "stranger"), null);
    assert.notEqual(seatOfUser(playerMap, "stranger"), 0);
  });

  test("findViewerSeat matches seatOfUser (it's the server-authoritative source for viewerSeatIndex)", () => {
    assert.equal(findViewerSeat(playerMap, "alice"), 0);
    assert.equal(findViewerSeat(playerMap, "ghost"), null);
  });

  test("seat 0 is only ever returned for the user actually seated there", () => {
    assert.equal(seatOfUser({ 0: "alice" }, "alice"), 0);
    assert.equal(seatOfUser({ 1: "bob" }, "someone-else"), null);
  });
});

describe("isBotSeatKey (bot-seat exclusion from match scoring)", () => {
  test("a bot: sentinel is a vacated seat, a userId is not", () => {
    assert.equal(isBotSeatKey("bot:1"), true);
    assert.equal(isBotSeatKey("alice"), false);
  });

  test("a userId that merely contains the substring 'bot:' but doesn't start with it is kept", () => {
    // scoreKeyForSeat only ever produces `bot:<seat>` as a prefix, but this
    // pins the exact matching rule (startsWith, not includes).
    assert.equal(isBotSeatKey("robot:99"), false);
  });
});

describe("scoreKeyForSeat", () => {
  test("a seated user scores under their own userId", () => {
    assert.equal(scoreKeyForSeat({ 0: "alice" }, 0), "alice");
  });

  test("a vacated seat scores under the bot: sentinel", () => {
    assert.equal(scoreKeyForSeat({ 0: "alice" }, 1), "bot:1");
    assert.equal(scoreKeyForSeat({}, 2), "bot:2");
  });

  test("the sentinels it produces are the ones isBotSeatKey rejects", () => {
    const playerMap = { 0: "alice" }; // seat 1 vacated
    assert.equal(isBotSeatKey(scoreKeyForSeat(playerMap, 0)), false);
    assert.equal(isBotSeatKey(scoreKeyForSeat(playerMap, 1)), true);
  });
});

describe("teams seating (buildSeatRoster + teamForSeat)", () => {
  const seats = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      seatIndex: i,
      userId: `u${i}`,
      username: `p${i}`,
    }));

  const teamsOf = (roster: { seatIndex: number }[]) =>
    roster.map((_, idx) => teamForSeat(idx, roster.length, "teams"));

  test("a full teams table is two A seats and two B seats, sitting opposite", () => {
    const roster = buildSeatRoster(seats(TEAMS_PLAYER_COUNT), TEAMS_PLAYER_COUNT, {});
    const teams = teamsOf(roster);
    assert.deepEqual(teams, ["A", "B", "A", "B"]);
    assert.equal(teams.filter((t) => t === "A").length, 2);
    assert.equal(teams.filter((t) => t === "B").length, 2);
  });

  test("a bot-filled teams table is still two and two", () => {
    const roster = buildSeatRoster(seats(1), TEAMS_PLAYER_COUNT, { fillWithBots: true });
    assert.equal(roster.length, TEAMS_PLAYER_COUNT);
    assert.deepEqual(teamsOf(roster), ["A", "B", "A", "B"]);
  });

  test("an odd table has no teams to split into", () => {
    for (const count of [2, 3]) {
      const roster = buildSeatRoster(seats(count), count, {});
      assert.deepEqual(
        teamsOf(roster),
        new Array(count).fill(undefined),
        `${count} seats cannot be a 2-v-2`
      );
    }
  });

  test("free-for-all never assigns a team, however many seats", () => {
    const roster = buildSeatRoster(seats(TEAMS_PLAYER_COUNT), TEAMS_PLAYER_COUNT, {});
    assert.deepEqual(
      roster.map((_, idx) => teamForSeat(idx, roster.length, "free_for_all")),
      new Array(TEAMS_PLAYER_COUNT).fill(undefined)
    );
  });
});

describe("restoredMatchOver (rehydrating a match after a restart)", () => {
  const teamed = [{ team: "A" as const }, { team: "B" as const }, { team: "A" as const }, { team: "B" as const }];
  const seats = { 0: "a1", 1: "b1", 2: "a2", 3: "b2" };

  test("a teams pair that has crossed the target restores as over", () => {
    // Neither key reaches 21 alone; the pair holds 22, so the match is won.
    assert.equal(
      restoredMatchOver({
        matchLength: "match",
        gameMode: "teams",
        handOver: true,
        scores: { a1: 11, b1: 5, a2: 11, b2: 4 },
        target: 21,
        playerCount: 4,
        teamOfKey: teamKeyMap(seats, teamed),
      }),
      true
    );
  });

  test("the same totals in a free-for-all are still a running match", () => {
    assert.equal(
      restoredMatchOver({
        matchLength: "match",
        gameMode: "free_for_all",
        handOver: true,
        scores: { a1: 11, b1: 5, a2: 11, b2: 4 },
        target: 21,
        playerCount: 4,
        teamOfKey: {},
      }),
      false
    );
  });

  test("a teams pair short of the target restores as still running", () => {
    assert.equal(
      restoredMatchOver({
        matchLength: "match",
        gameMode: "teams",
        handOver: true,
        scores: { a1: 9, b1: 5, a2: 9, b2: 4 },
        target: 21,
        playerCount: 4,
        teamOfKey: teamKeyMap(seats, teamed),
      }),
      false
    );
  });

  test("a vacated partner's seat is not counted towards the pair", () => {
    // teamKeyMap omits the seat with no playerMap entry, so a2's 11 points
    // are outside the team total and the pair is short of 21.
    const withVacancy = teamKeyMap({ 0: "a1", 1: "b1", 3: "b2" }, teamed);
    assert.deepEqual(withVacancy, { a1: "A", b1: "B", b2: "B" });
    assert.equal(
      restoredMatchOver({
        matchLength: "match",
        gameMode: "teams",
        handOver: true,
        scores: { a1: 11, b1: 5, a2: 11, b2: 4 },
        target: 21,
        playerCount: 4,
        teamOfKey: withVacancy,
      }),
      false
    );
  });

  test("a single-manche game is over exactly when its hand is", () => {
    const single = (handOver: boolean) =>
      restoredMatchOver({
        matchLength: "single",
        gameMode: "teams",
        handOver,
        scores: {},
        target: 21,
        playerCount: 4,
        teamOfKey: teamKeyMap(seats, teamed),
      });
    assert.equal(single(true), true);
    assert.equal(single(false), false);
  });
});
