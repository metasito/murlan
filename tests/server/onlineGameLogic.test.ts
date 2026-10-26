import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  seatOfUser,
  scoreKeyForSeat,
  buildSeatRoster,
  resolveRoundEnd,
  visibleExchangePhase,
} from "../../server/game/onlineGameLogic.ts";
import { exchangeAnnounceMs } from "../../lib/timeline/exchangeTimeline.ts";
import type { ExchangePhase, GameState, Player } from "../../lib/game/gameEngine.ts";
import { aThreePlayed, card } from "../support/game.ts";
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

describe("buildSeatRoster", () => {
  const human = (seatIndex: number) => ({ seatIndex, userId: `u${seatIndex}`, username: `p${seatIndex}` });

  test("seats the humans in seat order, each marked as a person, whatever order they came in", () => {
    const roster = buildSeatRoster([human(3), human(0), human(2)], 4, {});
    assert.deepEqual(roster, [
      { ...human(0), isBot: false },
      { ...human(2), isBot: false },
      { ...human(3), isBot: false },
    ]);
  });

  test("fills the gaps with bots and lists the whole table in seat order", () => {
    const roster = buildSeatRoster([human(3), human(1)], 4, { fillWithBots: true });
    assert.deepEqual(
      roster.map((r) => [r.seatIndex, r.isBot]),
      [
        [0, true],
        [1, false],
        [2, true],
        [3, false],
      ]
    );
    assert.deepEqual(
      roster.filter((r) => r.isBot).map((r) => r.userId),
      [botSeatKey(0), botSeatKey(2)]
    );
  });

  test("leaves the caller's list of humans as it was", () => {
    const humans = [human(2), human(0)];
    buildSeatRoster(humans, 4, { fillWithBots: true });
    assert.deepEqual(humans, [human(2), human(0)]);
  });
});

describe("visibleExchangePhase after the ceremony", () => {
  test("a seat that only watched is told who traded and nothing of the card the winner chose", () => {
    const settled: ExchangePhase = {
      kind: "settled",
      winnerIdx: 1,
      loserIdx: 3,
      cardFromLoser: card("2", "spades"),
      cardToLoser: card("6", "clubs"),
      settledAt: 1_000_000,
    };
    const after = 1_000_000 + exchangeAnnounceMs(false);

    assert.deepEqual(visibleExchangePhase(settled, 0, after), { kind: "settled", winnerIdx: 1, loserIdx: 3 });
    assert.deepEqual(visibleExchangePhase(settled, null, after), { kind: "settled", winnerIdx: 1, loserIdx: 3 });
  });
});

describe("resolveRoundEnd — who is told what", () => {
  const hand = (n: number) => Array.from({ length: n }, () => ({ rank: "3", suit: "spades" }) as never);
  const seats = (hands: number[], team?: (i: number) => "A" | "B"): Player[] =>
    hands.map((n, i) => ({ id: `p${i}`, name: `P${i}`, hand: hand(n), type: "human", ...(team ? { team: team(i) } : {}) }));
  const over = (players: Player[], finishingOrder: string[], gameMode: GameState["gameMode"] = "free_for_all"): GameState => ({
    players,
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: -1,
    passCount: 0,
    gameMode,
    roundOver: true,
    finishingOrder,
    openingCard: null,
    playedRanks: aThreePlayed(),
    lastMove: { seq: 0, kind: "deal" },
  });
  const NAMES = { 0: "alice", 1: "bob", 2: "carl", 3: "dee" };

  test("a walkout is placed behind everyone who stayed, and every seat appears once", () => {
    const result = resolveRoundEnd({
      state: over(seats([0, 4, 5, 6]), ["p0", "p1", "p2", "p3"]),
      playerMap: { 0: "alice", 2: "carl", 3: "dee" },
      cumulativeScores: {},
      matchTarget: 21,
      matchLength: "match",
      gameMode: "free_for_all",
      roundFlags: {},
      abandonedSeats: new Map([[1, "bob"]]),
    });

    assert.deepEqual(
      result.gameResults.map((r) => [r.userId, r.placement, r.abandoned]),
      [
        ["alice", 1, false],
        ["carl", 2, false],
        ["dee", 3, false],
        ["bob", 4, true],
      ]
    );
  });

  test("a bomb or joker is credited to the seat that played it, and to no other", () => {
    const result = resolveRoundEnd({
      state: over(seats([0, 4, 5, 6]), ["p0", "p1", "p2", "p3"]),
      playerMap: NAMES,
      cumulativeScores: {},
      matchTarget: 21,
      matchLength: "match",
      gameMode: "free_for_all",
      roundFlags: { 1: { bomb: true, joker: false }, 2: { bomb: false, joker: true } },
      abandonedSeats: new Map(),
    });

    assert.deepEqual(
      result.gameResults.map((r) => [r.userId, r.playedBomb, r.playedJoker]),
      [
        ["alice", false, false],
        ["bob", true, false],
        ["carl", false, true],
        ["dee", false, false],
      ]
    );
  });

  test("only the player who takes the match is marked as having won it", () => {
    const result = resolveRoundEnd({
      state: over(seats([0, 4, 5, 6]), ["p0", "p1", "p2", "p3"]),
      playerMap: NAMES,
      cumulativeScores: { alice: 18 },
      matchTarget: 21,
      matchLength: "match",
      gameMode: "free_for_all",
      roundFlags: {},
      abandonedSeats: new Map(),
    });

    assert.deepEqual(
      result.gameResults.map((r) => [r.userId, r.matchWon]),
      [
        ["alice", true],
        ["bob", false],
        ["carl", false],
        ["dee", false],
      ]
    );
  });

  test("a drawn single round names no match winner among the drawing teams", () => {
    const result = resolveRoundEnd({
      state: over(seats([0, 0, 0, 8], (i) => (i % 2 === 0 ? "A" : "B")), ["p0", "p1", "p3", "p2"], "teams"),
      playerMap: NAMES,
      cumulativeScores: {},
      matchTarget: 21,
      matchLength: "single",
      gameMode: "teams",
      roundFlags: {},
      abandonedSeats: new Map(),
    });

    assert.equal(result.isDraw, true);
    assert.equal(result.matchWinners.length > 0, true, "the drawing teams are the round's top teams");
    assert.deepEqual(
      result.gameResults.map((r) => r.matchWon),
      [false, false, false, false]
    );
  });

  test("a walkout's seat still counts as a person's, so a table with half its seats walked out is recorded", () => {
    const result = resolveRoundEnd({
      state: over(seats([0, 4, 5, 6]), ["p0", "p1", "p2", "p3"]),
      playerMap: { 0: "alice" },
      cumulativeScores: {},
      matchTarget: 21,
      matchLength: "match",
      gameMode: "free_for_all",
      roundFlags: {},
      abandonedSeats: new Map([[1, "bob"]]),
    });

    assert.equal(result.recordable, true);
  });
});
