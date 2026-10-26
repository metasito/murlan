import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  seatOfUser,
  scoreKeyForSeat,
  buildSeatRoster,
} from "../../server/game/onlineGameLogic.ts";
import { readPersistedPlayerMap } from "../../shared/persistedEnvelope.ts";
import { botSeatIndex, botSeatKey, isBotSeatKey } from "../../lib/game/botSeat.ts";
import { teamForSeat, TEAMS_PLAYER_COUNT } from "../../lib/game/gameEngine.ts";

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

describe("seatOfUser", () => {
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

describe("botSeatKey and botSeatIndex", () => {
  test("a key names the seat it was made for", () => {
    assert.equal(botSeatKey(3), "bot:3");
    for (const seat of [0, 1, 3]) assert.equal(botSeatIndex(botSeatKey(seat)), seat);
  });

  test("a key whose suffix is not a whole number names no seat", () => {
    assert.equal(botSeatIndex("bot:x"), null);
    assert.equal(botSeatIndex("bot:1.5"), null);
  });

  test("only a key botSeatKey could have made names a seat", () => {
    for (const key of ["bot:", "5", "u5", "bot:-1", "bot: 2", "bot:2 ", "bot:0x2", "bot:1e1"]) {
      assert.equal(botSeatIndex(key), null, key);
    }
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
