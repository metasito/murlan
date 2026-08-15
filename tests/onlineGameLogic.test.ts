import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  readPersistedPlayerMap,
  seatOfUser,
  scoreKeyForSeat,
  findViewerSeat,
  excludeBotSeats,
  isStaleSchema,
  GAME_SCHEMA_VERSION,
} from "../server/onlineGameLogic.ts";

describe("readPersistedPlayerMap (seat resolution on rejoin)", () => {
  test("prefers the seat -> userId map when present", () => {
    const map = readPersistedPlayerMap({ "0": "alice", "2": "carol" }, ["alice", "bob", "carol"]);
    assert.deepEqual(map, { 0: "alice", 2: "carol" });
  });

  test("falls back to the positional array when the map is empty", () => {
    const map = readPersistedPlayerMap({}, ["alice", "bob", "carol"]);
    assert.deepEqual(map, { 0: "alice", 1: "bob", 2: "carol" });
  });

  test("falls back to the positional array when the map is missing", () => {
    const map = readPersistedPlayerMap(undefined, ["alice", "bob"]);
    assert.deepEqual(map, { 0: "alice", 1: "bob" });
  });

  test("a non-contiguous seat map is not collapsed by the array fallback", () => {
    // This is the exact corruption this function exists to prevent: a
    // rejoining player must land on their own seat, not a compacted index.
    const map = readPersistedPlayerMap({ "0": "alice", "3": "dan" }, ["alice", "dan"]);
    assert.deepEqual(map, { 0: "alice", 3: "dan" });
    assert.equal(seatOfUser(map, "dan"), 3);
  });

  test("ignores non-string values and non-integer keys in the map", () => {
    const map = readPersistedPlayerMap({ "0": "alice", "x": "bob", "1": 42 }, []);
    assert.deepEqual(map, { 0: "alice" });
  });

  test("an empty map and empty array resolve to an empty seating", () => {
    assert.deepEqual(readPersistedPlayerMap({}, []), {});
    assert.deepEqual(readPersistedPlayerMap(null, null), {});
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

describe("excludeBotSeats (bot-seat exclusion from match scoring)", () => {
  test("drops bot: entries, keeps real userIds", () => {
    const hand = { alice: 3, "bot:1": 2, carol: 1, "bot:3": 0 };
    assert.deepEqual(excludeBotSeats(hand), { alice: 3, carol: 1 });
  });

  test("a fully bot-vacated hand scores nobody", () => {
    assert.deepEqual(excludeBotSeats({ "bot:0": 3, "bot:1": 2 }), {});
  });

  test("no bot seats: passthrough unchanged", () => {
    const hand = { alice: 3, bob: 2 };
    assert.deepEqual(excludeBotSeats(hand), hand);
  });

  test("does not mutate the input", () => {
    const hand = { alice: 3, "bot:0": 1 };
    const copy = { ...hand };
    excludeBotSeats(hand);
    assert.deepEqual(hand, copy);
  });

  test("a userId that merely contains the substring 'bot:' but doesn't start with it is kept", () => {
    // scoreKeyForSeat only ever produces `bot:<seat>` as a prefix, but this
    // pins the exact matching rule (startsWith, not includes).
    const hand = { "robot:99": 5 };
    assert.deepEqual(excludeBotSeats(hand), { "robot:99": 5 });
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

  test("bot: sentinels round-trip through excludeBotSeats", () => {
    const playerMap = { 0: "alice" }; // seat 1 vacated
    const handByKey = {
      [scoreKeyForSeat(playerMap, 0)]: 3,
      [scoreKeyForSeat(playerMap, 1)]: 0,
    };
    assert.deepEqual(excludeBotSeats(handByKey), { alice: 3 });
  });
});

describe("isStaleSchema / GAME_SCHEMA_VERSION (rejection of pre-full-deck persisted games)", () => {
  test("a row with no schemaVersion at all is stale", () => {
    // Every active_games row written before this field existed — exactly
    // the pre-full-deck-deal rows the fix targets.
    assert.equal(isStaleSchema(null), true);
    assert.equal(isStaleSchema(undefined), true);
    assert.equal(isStaleSchema({}), true);
  });

  test("a row stamped with a different version is stale", () => {
    assert.equal(isStaleSchema({ schemaVersion: GAME_SCHEMA_VERSION - 1 }), true);
    assert.equal(isStaleSchema({ schemaVersion: GAME_SCHEMA_VERSION + 1 }), true);
  });

  test("a row stamped with the current version is current, not stale", () => {
    assert.equal(isStaleSchema({ schemaVersion: GAME_SCHEMA_VERSION }), false);
  });
});
