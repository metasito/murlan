// tests/gameOver.test.ts — what server/gameOver.ts does *around* the hand
// resolution: the broadcast, the two awaited writes and the three
// fire-and-forget ones.
//
// The resolution itself is tests/handEnd.test.ts's: match at target, tie
// escalation, draws, the teams pair total and the `bot:<seat>` exclusion are
// all proved against resolveHandEnd there, and are deliberately not repeated.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { Server as SocketServer } from "socket.io";
import { handleGameOver } from "../server/gameOver.ts";
import type { GameOverWriters } from "../server/gameOver.ts";
import type { OnlineGameState } from "../server/gameRoom.ts";
import type { GameState, Player } from "../lib/gameEngine.ts";
import type { ReplayMove } from "../lib/replay.ts";

const ROOM = "room_1";

type Emitted = { room: string; event: string; payload: unknown };
type Call = { name: string; args: unknown[] };

/**
 * A stub socket server and a stub writer set sharing one `order` log, so a
 * test can assert what ran before what: the table has to hear the result
 * before any write is attempted, because two of the four call sites invoke
 * handleGameOver as a bare `void` and a slow database would otherwise hold
 * the result back.
 *
 * A writer given an Error rejects with it instead of resolving.
 */
function stubServer(overrides: Partial<Record<keyof GameOverWriters, Error>> = {}) {
  const order: string[] = [];
  const emitted: Emitted[] = [];
  const calls: Call[] = [];

  const io = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        order.push(event);
        emitted.push({ room, event, payload });
      },
    }),
  };

  const record =
    (name: keyof GameOverWriters) =>
    (...args: unknown[]) => {
      order.push(name);
      calls.push({ name, args });
      const failure = overrides[name];
      return failure ? Promise.reject(failure) : Promise.resolve(undefined);
    };

  const writers = {
    updateRoomStatus: record("updateRoomStatus"),
    persistGameState: record("persistGameState"),
    recordGameResult: record("recordGameResult"),
    recordRatedResult: record("recordRatedResult"),
    saveReplay: record("saveReplay"),
    // A read, not a write, and the one thing that must happen *before* the
    // broadcast: the rating delta stops existing once the rated write lands.
    previewRatedDeltas: (...args: unknown[]) => {
      order.push("previewRatedDeltas");
      calls.push({ name: "previewRatedDeltas" as keyof GameOverWriters, args });
      const failure = overrides.previewRatedDeltas;
      return failure ? Promise.reject(failure) : Promise.resolve(new Map<string, number>());
    },
  } as unknown as GameOverWriters;

  return {
    io: io as unknown as SocketServer,
    writers,
    order,
    emitted,
    names: () => calls.map((c) => c.name),
    of: (name: keyof GameOverWriters) => calls.filter((c) => c.name === name),
  };
}

function seat(id: string, name: string, cards: number, finishPosition?: number): Player {
  return {
    id,
    name,
    type: "human",
    finishPosition,
    hand: Array.from({ length: cards }, (_, i) => ({
      id: `${id}_c${i}`,
      suit: "hearts" as const,
      rank: "4" as const,
      isJoker: false,
    })),
  };
}

function finishedState(overrides: Partial<GameState> = {}): GameState {
  return {
    players: [seat("player_0", "Alice", 0, 1), seat("player_1", "Bob", 3, 2)],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: 0,
    passCount: 0,
    gameMode: "free_for_all",
    roundWinner: null,
    gameOver: true,
    rankings: ["player_0", "player_1"],
    firstPlayMade: true,
    ...overrides,
  };
}

const A_MOVE: ReplayMove = { seat: 0, combo: null, handCounts: [0, 3] };

function makeGame(overrides: Partial<OnlineGameState> = {}): OnlineGameState {
  return {
    gameState: finishedState(),
    playerMap: { 0: "u_alice", 1: "u_bob" },
    roomId: ROOM,
    joinCode: "ABC123",
    rematchVotes: new Set(["u_alice"]),
    rematchIntents: new Map(),
    cumulativeScores: {},
    gameMode: "free_for_all",
    maxPlayers: 2,
    matchTarget: 21,
    matchLength: "match",
    matchOver: false,
    handFlags: {},
    abandonedSeats: new Map(),
    spectators: new Set(),
    moveLog: [A_MOVE],
    dealFirstSeat: 0,
    ...overrides,
  };
}

describe("handleGameOver — the broadcast", () => {
  test("the table is told once, before any write is attempted", async () => {
    const s = stubServer();

    await handleGameOver(s.io, ROOM, makeGame(), s.writers);

    // By name rather than by position: `previewRatedDeltas` runs first and is
    // a read. What the guarantee is about is that no *write* is attempted
    // before the table has been told.
    const WRITES = [
      "updateRoomStatus",
      "persistGameState",
      "recordGameResult",
      "recordRatedResult",
      "saveReplay",
    ];
    const emittedAt = s.order.indexOf("game:over");
    const firstWrite = s.order.findIndex((name) => WRITES.includes(name));
    assert.ok(emittedAt >= 0, "the table is told");
    assert.ok(
      firstWrite === -1 || emittedAt < firstWrite,
      `nothing is written ahead of the result: ${s.order.join(" → ")}`
    );
    assert.deepEqual(
      s.emitted.map((e) => e.event),
      ["game:over"],
      "one hand, one game:over"
    );
    assert.equal(s.emitted[0].room, ROOM);
  });

  test("game:over carries the resolution the game was updated with", async () => {
    const s = stubServer();
    const game = makeGame();

    await handleGameOver(s.io, ROOM, game, s.writers);

    const payload = s.emitted[0].payload as Record<string, unknown>;
    assert.deepEqual(payload.rankings, ["player_0", "player_1"]);
    assert.equal(payload.matchTarget, game.matchTarget);
    assert.equal(payload.matchOver, game.matchOver);
    assert.equal(payload.matchLength, "match");
    assert.equal(payload.isDraw, false);
    assert.deepEqual(payload.cumulativeScores, {
      Alice: game.cumulativeScores.u_alice,
      Bob: game.cumulativeScores.u_bob,
    });
    assert.equal(
      (payload.scores as unknown[]).length,
      2,
      "one scoreboard row per seat"
    );
  });

  test("a single-manche game names the manche winner as the match winner", async () => {
    const s = stubServer();
    const game = makeGame({ matchLength: "single" });

    await handleGameOver(s.io, ROOM, game, s.writers);

    const payload = s.emitted[0].payload as Record<string, unknown>;
    assert.equal(payload.matchOver, true, "one manche is the whole match");
    assert.deepEqual(payload.matchWinners, ["Alice"], "Alice emptied her hand first");
    assert.equal(payload.isDraw, false);
    assert.equal(game.matchOver, true, "the game carries the same verdict");
  });

  test("the ready gate is emptied so the next manche starts from no votes", async () => {
    const s = stubServer();
    const game = makeGame();

    await handleGameOver(s.io, ROOM, game, s.writers);

    assert.equal(game.rematchVotes.size, 0);
  });
});

describe("handleGameOver — the writes", () => {
  test("each writer is called exactly once, with the arguments it expects", async () => {
    const s = stubServer();
    const game = makeGame();

    await handleGameOver(s.io, ROOM, game, s.writers);

    assert.deepEqual(s.names(), [
      // First, and a read: the delta it returns cannot be recovered once the
      // rated write below has landed.
      "previewRatedDeltas",
      "updateRoomStatus",
      "persistGameState",
      "recordGameResult",
      "recordRatedResult",
      "saveReplay",
    ]);

    assert.deepEqual(s.of("updateRoomStatus")[0].args, [ROOM, "finished"]);

    // One clock for the preview and the rated write: the season key is derived
    // from it, and two `new Date()` calls can straddle a month boundary.
    assert.equal(
      s.of("previewRatedDeltas")[0].args[2],
      s.of("recordRatedResult")[0].args[2],
      "the delta is read for the same season it is written to"
    );

    const persisted = s.of("persistGameState")[0].args;
    assert.equal(persisted[0], ROOM);
    assert.equal(persisted[1], game, "the row is written from the game as resolved");

    const [results, mode] = s.of("recordGameResult")[0].args as [
      { userId: string; placement: number }[],
      string,
    ];
    assert.equal(mode, "free_for_all");
    assert.deepEqual(
      results.map((r) => [r.userId, r.placement]),
      [
        ["u_alice", 1],
        ["u_bob", 2],
      ]
    );

    const rated = s.of("recordRatedResult")[0].args;
    assert.deepEqual(rated[0], results, "the ladder rates the seats stats records");
    assert.equal(rated[1], "free_for_all");
    assert.ok(rated[2] instanceof Date);

    assert.deepEqual(s.of("saveReplay")[0].args[0], {
      roomId: ROOM,
      gameMode: "free_for_all",
      seats: [
        { seatIndex: 0, userId: "u_alice", name: "Alice" },
        { seatIndex: 1, userId: "u_bob", name: "Bob" },
      ],
      moves: [A_MOVE],
      rankings: ["player_0", "player_1"],
    });
  });

  test("a bot-majority table records no stats and no rating, but keeps the replay", async () => {
    const s = stubServer();
    // One human, three bots — a seat with no playerMap entry is a bot.
    const game = makeGame({
      gameState: finishedState({
        players: [
          seat("player_0", "Alice", 0, 1),
          seat("player_1", "Bot 1", 2, 2),
          seat("player_2", "Bot 2", 3, 3),
          seat("player_3", "Bot 3", 4, 4),
        ],
        rankings: ["player_0", "player_1", "player_2", "player_3"],
      }),
      playerMap: { 0: "u_alice" },
      maxPlayers: 4,
    });

    await handleGameOver(s.io, ROOM, game, s.writers);

    assert.deepEqual(s.names(), ["updateRoomStatus", "persistGameState", "saveReplay"]);
  });

  test("a hand with no move log writes no replay", async () => {
    const noLog = stubServer();
    await handleGameOver(noLog.io, ROOM, makeGame({ moveLog: null }), noLog.writers);
    assert.deepEqual(noLog.of("saveReplay"), []);

    const empty = stubServer();
    await handleGameOver(empty.io, ROOM, makeGame({ moveLog: [] }), empty.writers);
    assert.deepEqual(empty.of("saveReplay"), []);
  });
});

describe("handleGameOver — a failing write is not the table's problem", () => {
  test("the room status failing does not stop the row being written", async () => {
    const s = stubServer({ updateRoomStatus: new Error("no rooms row") });

    await handleGameOver(s.io, ROOM, makeGame(), s.writers);

    assert.equal(s.of("persistGameState").length, 1);
    assert.equal(s.of("recordGameResult").length, 1);
  });

  test("a rejected stats, ladder or replay write does not reject the caller", async () => {
    const s = stubServer({
      recordGameResult: new Error("stats down"),
      recordRatedResult: new Error("ladder down"),
      saveReplay: new Error("replays down"),
    });

    // Two of the four call sites invoke this as a bare `void`, so a
    // rejection has nothing to catch it: it surfaces as an unhandled
    // rejection and takes the process out through the boot guards.
    await handleGameOver(s.io, ROOM, makeGame(), s.writers);

    assert.deepEqual(
      s.emitted.map((e) => e.event),
      ["game:over"],
      "the table still heard the result"
    );
  });
});
