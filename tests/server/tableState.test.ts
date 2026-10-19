// tests/server/tableState.test.ts — a table packed for active_games and read back
// is the table that was packed, minus what never leaves memory. No database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MEMORY_ONLY, PERSISTED, fromEnvelope, newTable, toEnvelope } from "../../server/game/tableState.ts";
import { GAME_SCHEMA_VERSION } from "../../shared/persistedEnvelope.ts";
import { firstTargetFor, initializeGame } from "../../lib/game/gameEngine.ts";
import type { GameState } from "../../lib/game/gameEngine.ts";
import type { OnlineGameState } from "../../server/game/gameRoom.ts";
import type { RoundOverPayload } from "../../lib/game/matchState.ts";
import { onlineTable } from "../helpers/onlineTable.ts";

const ROOM = "table-state-room";

/** What jsonb hands back: `undefined` properties gone, everything plain. */
const viaJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function dealt(): GameState {
  return viaJson(
    initializeGame(
      [
        { name: "Alice", type: "human" },
        { name: "Bob", type: "human" },
        { name: "Carl", type: "human" },
        { name: "Bot", type: "bot", personality: "besnik" },
      ],
      "free_for_all"
    )
  );
}

// Every field set, none to the value a read-back would default it to: a field
// packed but dropped on the way back then differs.
function midMatch(): OnlineGameState {
  const table: Required<OnlineGameState> = {
    roomId: ROOM,
    joinCode: "QW3RTY",
    gameState: dealt(),
    playerMap: { 0: "alice", 2: "carl" },
    cumulativeScores: { alice: 7, bob: 3, carl: 12, "bot:3": 4 },
    gameMode: "teams",
    maxPlayers: 4,
    matchTarget: 31,
    matchLength: "single",
    roundsPlayed: 2,
    matchOver: true,
    endedByVote: true,
    roundFlags: { 0: { bomb: true, joker: false } },
    abandonedSeats: new Map([[1, "bob"]]),
    botSeatsAtStart: new Set([3]),
    releasedSeats: new Set(["bob"]),
    vacatedSeats: new Map([[1, { userId: "bob", username: "Bob" }]]),
    weakSeats: new Set([1]),
    dealFirstSeat: 2,
    rematchVotes: new Set(["alice"]),
    endMatchVotes: new Set(["carl"]),
    spectators: new Set(["zed"]),
    moveLog: [],
    turnDeadlineMs: 123,
    lastRoundOverPayload: {} as RoundOverPayload,
    resultWrites: Promise.resolve(),
  };
  return table;
}

const persisted = (game: OnlineGameState) => ({ roomId: game.roomId, gameState: viaJson(toEnvelope(game)) });

function withoutMemoryOnly(game: OnlineGameState): Partial<OnlineGameState> {
  const kept: Record<string, unknown> = { ...game };
  for (const field of MEMORY_ONLY) delete kept[field];
  return kept;
}

describe("a table's round trip through active_games", () => {
  test("comes back as it left, minus the memory-only fields", () => {
    const game = midMatch();
    const back = fromEnvelope(persisted(game));
    assert.ok(back.ok, back.ok ? "" : back.reason);
    assert.deepEqual(Object.keys(game).sort(), [...PERSISTED, ...MEMORY_ONLY].sort());
    assert.deepEqual(withoutMemoryOnly(back.game), withoutMemoryOnly(game));
  });

  test("the memory-only fields come back empty, and a restored round writes no replay", () => {
    const back = fromEnvelope(persisted(midMatch()));
    assert.ok(back.ok);
    assert.deepEqual(back.game.rematchVotes, new Set());
    assert.deepEqual(back.game.endMatchVotes, new Set());
    assert.deepEqual(back.game.spectators, new Set());
    assert.equal(back.game.moveLog, null);
    assert.equal(back.game.turnDeadlineMs, undefined);
    assert.equal(back.game.lastRoundOverPayload, undefined);
    assert.equal(back.game.resultWrites, undefined);
  });

  test("packs the stored shape at the current schema version", () => {
    const game = midMatch();
    assert.deepEqual(toEnvelope(game), {
      schemaVersion: GAME_SCHEMA_VERSION,
      gameState: game.gameState,
      roundFlags: game.roundFlags,
      dealFirstSeat: 2,
      joinCode: "QW3RTY",
      match: {
        playerMap: { 0: "alice", 2: "carl" },
        scores: { alice: 7, bob: 3, carl: 12, "bot:3": 4 },
        gameMode: "teams",
        matchLength: "single",
        matchTarget: 31,
        maxPlayers: 4,
        roundsPlayed: 2,
        endedByVote: true,
        matchOver: true,
      },
      seats: {
        vacatedSeats: [[1, { userId: "bob", username: "Bob" }]],
        releasedSeats: ["bob"],
        weakSeats: [1],
        abandonedSeats: [[1, "bob"]],
      },
    });
  });

  test("a single round that was over comes back as a finished match", () => {
    const game = midMatch();
    game.matchLength = "single";
    game.endedByVote = false;
    game.matchOver = true;
    game.gameState = { ...game.gameState, roundOver: true };
    const back = fromEnvelope(persisted(game));
    assert.ok(back.ok);
    assert.equal(back.game.matchOver, true);
  });

  describe("the verdict the fold reached is the one that comes back", () => {
    const teamsTable = (matchOver: boolean, scores: Record<string, number>, playerMap: Record<number, string>) => {
      const game = midMatch();
      game.gameMode = "teams";
      game.matchLength = "match";
      game.endedByVote = false;
      game.matchTarget = 21;
      game.matchOver = matchOver;
      game.cumulativeScores = scores;
      game.playerMap = playerMap;
      game.vacatedSeats = new Map();
      game.gameState = {
        ...dealt(),
        roundOver: true,
        players: dealt().players.map((p, seat) => ({ ...p, team: seat % 2 === 0 ? "A" : "B" })),
      };
      return game;
    };
    const restoredOver = (game: OnlineGameState) => {
      const back = fromEnvelope(persisted(game));
      assert.ok(back.ok);
      return back.game.matchOver;
    };

    test("a pair that crossed through a bot: key stays over after the seat is taken by a newcomer", () => {
      const game = teamsTable(true, { alice: 11, "bot:2": 11, bob: 5 }, { 0: "alice", 1: "bob", 2: "newcomer" });
      assert.equal(restoredOver(game), true);
    });

    test("a pair that crossed stays over when the seat key no longer maps to its team", () => {
      const game = teamsTable(true, { alice: 11, "bot:2": 11, bob: 5 }, { 0: "alice", 1: "bob" });
      assert.equal(restoredOver(game), true);
    });

    test("a tie at the target stays a running match", () => {
      const game = teamsTable(false, { alice: 22, carl: 0, bob: 22, "bot:3": 0 }, { 0: "alice", 1: "bob", 2: "carl" });
      assert.equal(restoredOver(game), false);
    });

    test("a verdict of running is not re-derived from scores that look finished", () => {
      const game = teamsTable(false, { alice: 30, bob: 5 }, { 0: "alice", 1: "bob", 2: "carl", 3: "dan" });
      assert.equal(restoredOver(game), false);
    });
  });

  test("a newer revision's row is refused as newer, an older one as unrestorable", () => {
    const envelope = viaJson(toEnvelope(midMatch()));
    const newer = fromEnvelope({ roomId: ROOM, gameState: { ...envelope, schemaVersion: GAME_SCHEMA_VERSION + 1 } });
    assert.equal(newer.ok, false);
    assert.equal(!newer.ok && newer.newer, true);
    const older = fromEnvelope({ roomId: ROOM, gameState: { ...envelope, schemaVersion: GAME_SCHEMA_VERSION - 1 } });
    assert.equal(older.ok, false);
    assert.equal(!older.ok && older.newer, undefined);
  });
});

describe("a new table", () => {
  const room = { id: ROOM, code: "QW3RTY", gameMode: "free_for_all" as const, maxPlayers: 3 };
  const roster = [
    { seatIndex: 0, userId: "alice", username: "Alice", isBot: false },
    { seatIndex: 1, userId: "bob", username: "Bob", isBot: false },
    { seatIndex: 2, userId: "bot:2", username: "Bot", isBot: true, personality: "besnik" as const },
  ];

  test("seats the roster and starts a match from nothing", () => {
    const game = newTable(room, roster);
    assert.equal(game.roomId, ROOM);
    assert.equal(game.joinCode, "QW3RTY");
    assert.deepEqual(game.playerMap, { 0: "alice", 1: "bob" });
    assert.deepEqual(game.botSeatsAtStart, new Set([2]));
    assert.equal(game.gameState.players.length, 3);
    assert.deepEqual(game.cumulativeScores, {});
    assert.equal(game.matchTarget, firstTargetFor(3));
    assert.equal(game.matchLength, "match");
    assert.equal(game.roundsPlayed, 0);
    assert.equal(game.matchOver, false);
    assert.deepEqual(game.moveLog, []);
  });

  test("carries the previous match's scores, target and length, and the format asked for wins", () => {
    const previous = onlineTable({
      roomId: ROOM,
      cumulativeScores: { alice: 40 },
      matchTarget: 41,
      matchLength: "single",
      roundsPlayed: 5,
      matchOver: true,
      gameState: dealt(),
    });
    const carried = newTable(room, roster, previous);
    assert.deepEqual(carried.cumulativeScores, { alice: 40 });
    assert.equal(carried.matchTarget, 41);
    assert.equal(carried.matchLength, "single");
    assert.equal(carried.roundsPlayed, 5);
    assert.equal(carried.matchOver, true);
    assert.equal(newTable(room, roster, previous, "match").matchLength, "match");
  });
});
