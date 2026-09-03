// #850 clause 7: the seat is reclaimable by the same account for the life of
// the match. Routed through the real `applyOrForward` -> `applyTableAction`
// -> `rejoinAction` path (installTableHandlers wires the router to the real
// handler), rather than calling a private function directly, so the DoD's own
// four things — the rejoin path, both announcements, and the AFK-rearm guard
// — are each proved against the actual wiring, not a stand-in for it.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import type { Server as SocketServer } from "socket.io";
import { installTableHandlers, applyOrForward } from "../server/tableHandlers.ts";
import { armTurn } from "../server/gameTurn.ts";
import { activeGames } from "../server/gameRoom.ts";
import { clearRoomTimers } from "../server/gameTimers.ts";
import type { OnlineGameState } from "../server/gameRoom.ts";
import type { GameState, Player } from "../lib/gameEngine.ts";

const ROOM = "seat-reclaim-room";

function player(id: string, name: string, type: Player["type"] = "human"): Player {
  return { id, name, hand: [], type };
}

function baseGame(overrides: Partial<OnlineGameState>): OnlineGameState {
  return {
    roomId: ROOM,
    joinCode: "AAAAAA",
    playerMap: {},
    rematchVotes: new Set(),
    rematchIntents: new Map(),
    cumulativeScores: {},
    gameMode: "free_for_all",
    maxPlayers: 4,
    matchTarget: 21,
    matchLength: "match",
    handsPlayed: 1,
    matchOver: false,
    handFlags: {},
    abandonedSeats: new Map(),
    botSeatsAtStart: new Set(),
    releasedSeats: new Set(),
    vacatedSeats: new Map(),
    weakSeats: new Set(),
    endMatchVotes: new Set(),
    dealFirstSeat: 0,
    spectators: new Set(),
    moveLog: null,
    ...overrides,
  } as OnlineGameState;
}

function midHand(): GameState {
  return {
    players: [
      player("p0", "Alice"),
      player("p1", "Drita", "ai"),
      player("p2", "Carl"),
      player("p3", "Dee"),
    ],
    currentTurnIndex: 0, // Alice's turn, not the vacated seat's — no bot timer fires.
    lastPlayedCombination: null,
    lastPlayedBy: -1,
    passCount: 0,
    gameMode: "free_for_all",
    roundWinner: null,
    gameOver: false,
    rankings: [],
    firstPlayMade: true,
  };
}

function stubIo() {
  const emitted: { event: string; payload: unknown }[] = [];
  const target = {
    emit: (event: string, payload: unknown) => emitted.push({ event, payload }),
    timeout: () => ({ emit: (event: string, payload: unknown) => emitted.push({ event, payload }) }),
  };
  const io = { to: () => target, on: () => {} } as unknown as SocketServer;
  return { io, emitted };
}

// The router only routes to the real handler once wired — exactly what a
// live server does once, at boot, via setupSocket.
before(() => {
  installTableHandlers({ on: () => {} } as unknown as SocketServer);
});

describe("a vacated seat is reclaimable by the account that left it (#850 clause 7)", () => {
  test("reclaim restores the seat, and both the departure and the return are announced", async () => {
    const { io, emitted } = stubIo();
    const game = baseGame({
      gameState: midHand(),
      playerMap: { 0: "alice", 2: "carl", 3: "dee" }, // seat 1 already vacated
      vacatedSeats: new Map([[1, { userId: "drita", username: "Drita" }]]),
      releasedSeats: new Set(["drita"]),
    });
    activeGames.set(ROOM, game);

    try {
      const outcome = await applyOrForward(io, {
        kind: "rejoin",
        roomId: ROOM,
        userId: "drita",
        username: "Drita",
      });

      assert.equal(outcome.ok, true);
      assert.equal(game.playerMap[1], "drita", "the seat must read as drita's again");
      assert.ok(!game.vacatedSeats.has(1));
      assert.ok(!game.releasedSeats.has("drita"), "reclaiming un-releases the account");
      assert.equal(game.gameState.players[1]!.type, "human");

      const reconnected = emitted.find((e) => e.event === "game:player_reconnected");
      assert.ok(reconnected, "the return must be announced");
      assert.equal((reconnected!.payload as { seatIndex: number }).seatIndex, 1);
    } finally {
      clearRoomTimers(ROOM);
      activeGames.delete(ROOM);
    }
  });

  test("SEAT_RELEASED still answers once the seat itself is not reclaimable", async () => {
    const { io } = stubIo();
    const game = baseGame({
      gameState: midHand(),
      playerMap: { 0: "alice", 2: "carl", 3: "dee" },
      vacatedSeats: new Map(), // nothing of drita's left open to reclaim
      releasedSeats: new Set(["drita"]),
    });
    activeGames.set(ROOM, game);

    try {
      const outcome = await applyOrForward(io, {
        kind: "rejoin",
        roomId: ROOM,
        userId: "drita",
        username: "Drita",
      });
      assert.deepEqual(outcome, { ok: false, code: "SEAT_RELEASED" });
    } finally {
      activeGames.delete(ROOM);
    }
  });

  test("a stranger who never sat here is unauthorized, not seat-released", async () => {
    const { io } = stubIo();
    const game = baseGame({
      gameState: midHand(),
      playerMap: { 0: "alice", 2: "carl", 3: "dee" },
    });
    activeGames.set(ROOM, game);

    try {
      const outcome = await applyOrForward(io, {
        kind: "rejoin",
        roomId: ROOM,
        userId: "ghost",
        username: "Ghost",
      });
      assert.deepEqual(outcome, { ok: false, code: "UNAUTHORIZED" });
    } finally {
      activeGames.delete(ROOM);
    }
  });

  test("a reclaim ahead of a pending bot timer re-arms instead of playing the reclaimed seat's turn", async () => {
    const { io } = stubIo();
    const state = midHand();
    state.currentTurnIndex = 1; // the vacated seat's own turn is up next
    const game = baseGame({
      gameState: state,
      playerMap: { 0: "alice", 2: "carl", 3: "dee" }, // seat 1 vacant
      vacatedSeats: new Map([[1, { userId: "drita", username: "Drita" }]]),
      releasedSeats: new Set(["drita"]),
    });
    activeGames.set(ROOM, game);

    try {
      // A short, explicit delay stands in for botMoveDelayMs() so the test
      // does not wait out the real 1.2 s default.
      armTurn(io, ROOM, 5);
      assert.ok(!game.turnDeadlineMs, "a vacant acting seat carries no human AFK clock yet");

      // The reclaim lands while that timer is still pending.
      await applyOrForward(io, {
        kind: "rejoin",
        roomId: ROOM,
        userId: "drita",
        username: "Drita",
      });

      await new Promise((r) => setTimeout(r, 40));

      // The guard (server/gameTurn.ts's runBotTurn) sees the seat reclaimed
      // and re-arms rather than playing on drita's behalf — her hand is
      // untouched and the seat now carries a human AFK clock instead. Read
      // off `game.gameState`, not the local `state`: a real play would have
      // replaced it with a new object, leaving `state` stale.
      assert.equal(
        game.gameState.currentTurnIndex,
        1,
        "nothing played the reclaimed seat's turn for it"
      );
      assert.equal(typeof game.turnDeadlineMs, "number", "the seat now carries its own AFK clock");
    } finally {
      clearRoomTimers(ROOM);
      activeGames.delete(ROOM);
    }
  });
});
