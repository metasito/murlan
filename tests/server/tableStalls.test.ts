// Tables that stopped answering: a deal, a vote or a grace that never came.
import { test, describe, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Server as SocketServer } from "socket.io";
import { installTableHandlers, applyOrForward, rehydrateGame } from "../../server/game/tableHandlers.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import { clearRoomTimers } from "../../server/game/gameTimers.ts";
import { roomStore } from "../../server/store/roomStore.ts";
import { db } from "../../server/store/db.ts";
import { packPersistedState } from "../../server/game/onlineGameLogic.ts";
import type { OnlineGameState } from "../../server/game/gameRoom.ts";
import type { GameState, Player } from "../../lib/game/gameEngine.ts";

const ROOM = "table-stalls-room";

function player(id: string, name: string, type: Player["type"] = "human"): Player {
  return { id, name, hand: [], type };
}

function finishedHand(players: Player[], rankings: string[]): GameState {
  return {
    players,
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: -1,
    passCount: 0,
    gameMode: "free_for_all",
    roundWinner: null,
    gameOver: true,
    rankings,
    firstPlayMade: true,
  };
}

function baseGame(overrides: Partial<OnlineGameState>): OnlineGameState {
  return {
    roomId: ROOM,
    joinCode: "AAAAAA",
    playerMap: {},
    rematchVotes: new Set(),
    cumulativeScores: {},
    gameMode: "free_for_all",
    maxPlayers: 2,
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

function stubIo() {
  const emitted: { event: string; payload: unknown }[] = [];
  const target = {
    emit: (event: string, payload: unknown) => emitted.push({ event, payload }),
    timeout: () => ({ emit: (event: string, payload: unknown) => emitted.push({ event, payload }) }),
  };
  const io = { to: () => target, on: () => {} } as unknown as SocketServer;
  return { io, emitted };
}

const twoHumans = () => [player("player_0", "Ana"), player("player_1", "Besi")];

const room = { id: ROOM, code: "AAAAAA", gameMode: "free_for_all", maxPlayers: 2 };

const vote = (io: SocketServer, userId: string) =>
  applyOrForward(io, { kind: "rematchVote", roomId: ROOM, userId });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

before(() => {
  installTableHandlers({ on: () => {} } as unknown as SocketServer);
});

afterEach(() => {
  clearRoomTimers(ROOM);
  activeGames.delete(ROOM);
});

describe("a table restored after a restart", () => {
  test("a between-hands seat nobody came back to is released, so the vote it held up deals", async (t) => {
    process.env.MURLAN_LOBBY_GRACE_MS = "30";
    t.after(() => delete process.env.MURLAN_LOBBY_GRACE_MS);
    const { io, emitted } = stubIo();
    const row = packPersistedState(
      finishedHand(twoHumans(), ["player_0", "player_1"]),
      {},
      0,
      "AAAAAA",
      {
        playerMap: { 0: "ana", 1: "besi" },
        scores: { ana: 3, besi: 0 },
        gameMode: "free_for_all",
        matchLength: "match",
        matchTarget: 21,
        maxPlayers: 2,
        handsPlayed: 1,
        endedByVote: false,
      },
      { vacatedSeats: [], releasedSeats: [], weakSeats: [], abandonedSeats: [] }
    );
    t.mock.method(db.query.activeGames, "findFirst", async () => ({ roomId: ROOM, gameState: row }));
    t.mock.method(roomStore, "getRoomById", async () => room);
    t.mock.method(roomStore, "updateRoomStatus", async () => {});
    t.mock.method(roomStore, "releaseSeat", async () => null);

    assert.equal(await rehydrateGame(ROOM, "ana", io), "restored");
    const game = activeGames.get(ROOM)!;
    assert.equal(game.gameState.gameOver, true);

    await vote(io, "ana");
    assert.ok(!emitted.some((e) => e.event === "game:started"), "one vote of two deals nothing");

    await sleep(150);
    assert.equal(game.playerMap[1], undefined, "besi's seat went when the grace ran out");
    assert.ok(emitted.some((e) => e.event === "game:started"), "ana's vote now closes the gate");
    assert.equal(game.gameState.gameOver, false);
  });
});

describe("dealing the next manche", () => {
  test("a rooms.status write that fails still reaches every client", async (t) => {
    const { io, emitted } = stubIo();
    t.mock.method(roomStore, "getRoomById", async () => room);
    t.mock.method(roomStore, "updateRoomStatus", async () => {
      throw new Error("connection terminated");
    });
    const game = baseGame({
      gameState: finishedHand(twoHumans(), ["player_0", "player_1"]),
      playerMap: { 0: "ana", 1: "besi" },
      rematchVotes: new Set(["ana"]),
    });
    activeGames.set(ROOM, game);

    const outcome = await vote(io, "besi").catch((err: unknown) => err);

    assert.deepEqual(outcome, { ok: true });
    assert.equal(game.gameState.gameOver, false, "the next manche was dealt in memory");
    assert.ok(emitted.some((e) => e.event === "game:state"), "nobody was sent their hand");
    assert.ok(emitted.some((e) => e.event === "game:started"));
  });
});
