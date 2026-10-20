// tests/server/tableState.test.ts — a table packed for active_games and read back
// is the table that was packed, minus what never leaves memory. No database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MEMORY_ONLY, PERSISTED, fromEnvelope, newTable, toEnvelope } from "../../server/game/tableState.ts";
import { GAME_SCHEMA_VERSION } from "../../shared/persistedEnvelope.ts";
import { firstTargetFor, startRound } from "../../lib/game/gameEngine.ts";
import type { GameMode, GameState } from "../../lib/game/gameEngine.ts";
import type { OnlineGameState } from "../../server/game/gameRoom.ts";
import type { RoundOverPayload } from "../../lib/game/matchState.ts";
import { onlineTable } from "../helpers/onlineTable.ts";

const ROOM = "table-state-room";

/** What jsonb hands back: `undefined` properties gone, everything plain. */
const viaJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function dealt(mode: GameMode = "free_for_all"): GameState {
  return viaJson(
    startRound(
      [
        { name: "Alice", type: "human" },
        { name: "Bob", type: "human" },
        { name: "Carl", type: "human" },
        { name: "Bot", type: "bot", personality: "besnik" },
      ],
      mode
    )
  );
}

// Every field set, none to the value a read-back would default it to: a field
// packed but dropped on the way back then differs.
function midMatch(): OnlineGameState {
  const table: Required<OnlineGameState> = {
    roomId: ROOM,
    joinCode: "QW3RTY",
    gameState: dealt("teams"),
    playerMap: { 0: "alice", 2: "carl" },
    cumulativeScores: { alice: 7, bob: 3, carl: 12, "bot:3": 4 },
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

  describe("matchOver is stored, not re-derived (a boolean round trip; the fold's own verdict is tests/server/restoredVerdict.test.ts)", () => {
    const restoredOver = (matchOver: boolean, scores: Record<string, number>) => {
      const game = midMatch();
      game.endedByVote = false;
      game.matchOver = matchOver;
      game.cumulativeScores = scores;
      const back = fromEnvelope(persisted(game));
      assert.ok(back.ok);
      return back.game.matchOver;
    };

    test("a stored true survives scores that look unfinished", () => {
      assert.equal(restoredOver(true, {}), true);
    });

    test("a stored false survives scores far past the target", () => {
      assert.equal(restoredOver(false, { alice: 99, bob: 0 }), false);
    });
  });

  test("an open exchange the winner cannot give back from is refused; one they can is kept", () => {
    const withExchange = (winnerHand: GameState["players"][number]["hand"]) => {
      const game = midMatch();
      game.gameState.players[0].hand = winnerHand;
      game.gameState.exchangePhase = {
        active: true,
        winnerIdx: 0,
        loserIdx: 1,
        cardFromLoser: { id: "A_spades", rank: "A", suit: "spades", isJoker: false },
        twoJokerException: false,
      };
      return fromEnvelope(persisted(game));
    };
    assert.equal(withExchange([]).ok, false);
    assert.equal(withExchange([{ id: "5_clubs", rank: "5", suit: "clubs", isJoker: false }]).ok, true);
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

describe("a new match at a standing table", () => {
  const room = { id: ROOM, code: "QW3RTY", gameMode: "free_for_all" as const, maxPlayers: 3 };
  const seated = [
    { seatIndex: 0, userId: "alice", username: "Alice", isBot: false },
    { seatIndex: 1, userId: "bob", username: "Bob", isBot: false },
    { seatIndex: 2, userId: "carl", username: "Carl", isBot: false },
  ];
  const finished = (): OnlineGameState => {
    const gameState = viaJson(
      startRound(seated.map((r) => ({ name: r.username, type: "human" as const })), "free_for_all")
    );
    gameState.roundOver = true;
    gameState.finishingOrder = ["player_1", "player_2", "player_0"];
    return onlineTable({
      roomId: ROOM,
      gameState,
      playerMap: { 0: "alice", 1: "bob", 2: "carl" },
      matchOver: true,
    });
  };
  const reseated = (rows: typeof seated) => rows.map((r, seatIndex) => ({ ...r, seatIndex }));

  test("opens with the exchange between the last match's winner and loser, at their new seats", () => {
    const { exchangePhase } = newTable(room, reseated([seated[1], seated[0], seated[2]]), finished()).gameState;
    assert.equal(exchangePhase?.winnerIdx, 0);
    assert.equal(exchangePhase?.loserIdx, 1);
  });

  test("deals the 3♠ opening when the winner left the table", () => {
    const dan = { seatIndex: 2, userId: "dan", username: "Dan", isBot: false };
    const { gameState } = newTable(room, reseated([seated[0], seated[2], dan]), finished());
    assert.equal(gameState.exchangePhase, undefined);
    assert.equal(gameState.startReason?.type, "start_card");
  });
});
