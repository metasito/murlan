// Tables that stopped answering: a deal, a vote or a grace that never came.
import { test, describe, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Server as SocketServer } from "socket.io";
import { installTableHandlers, applyOrForward, rehydrateGame } from "../../server/game/tableHandlers.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import { clearAllTimersForUser, clearRoomTimers, disconnectTimers, usersInLobbyGrace } from "../../server/game/gameTimers.ts";
import { setSocketServer } from "../../server/socket/socketRegistry.ts";
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
  const io = {
    to: () => target,
    on: () => {},
    serverSideEmit: (_event: string, _userId: string, reply: () => void) => reply(),
    sockets: { adapter: { rooms: new Map() }, sockets: new Map() },
  } as unknown as SocketServer;
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
  for (const userId of ["ana", "besi"]) clearAllTimersForUser(userId, ROOM);
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

  test("two votes closing the gate together deal once, with the exchange", async (t) => {
    const { io, emitted } = stubIo();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    t.mock.method(roomStore, "getRoomById", async () => {
      await held;
      return room;
    });
    t.mock.method(roomStore, "updateRoomStatus", async () => {});
    const game = baseGame({
      gameState: finishedHand(twoHumans(), ["player_0", "player_1"]),
      playerMap: { 0: "ana", 1: "besi" },
      rematchVotes: new Set(["ana"]),
    });
    activeGames.set(ROOM, game);

    const first = vote(io, "besi");
    const second = vote(io, "ana");
    await sleep(10);
    assert.ok(!emitted.some((e) => e.event === "game:started"), "both are still waiting on the room read");
    release();
    await Promise.all([first, second]);

    assert.equal(emitted.filter((e) => e.event === "game:started").length, 1);
    assert.ok(game.gameState.exchangePhase, "the second deal threw the exchange away");
    assert.equal(game.gameState.exchangePhase.winnerIdx, 0);
    assert.equal(game.gameState.exchangePhase.loserIdx, 1);
  });
});

describe("a new match at a standing bot-filled table", () => {
  test("opens with the exchange on the last match's rankings, a bot's place among them", async (t) => {
    const { io, emitted } = stubIo();
    const host = "ana";
    const lobby = {
      id: ROOM,
      code: "AAAAAA",
      hostUserId: host,
      status: "finished",
      gameMode: "free_for_all",
      maxPlayers: 4,
      visibility: "private",
    };
    t.mock.method(roomStore, "getRoomById", async () => lobby);
    t.mock.method(roomStore, "updateRoomStatus", async () => {});
    t.mock.method(roomStore, "closeForStart", async () => ({
      ok: true,
      roster: [{ seatIndex: 0, userId: host, user: { username: "Ana" } }],
      room: { ...lobby, status: "in_progress" },
    }));
    const seats = [
      player("player_0", "Ana"),
      { ...player("player_1", "Bot 1", "ai"), personality: "besnik" },
      { ...player("player_2", "Bot 2", "ai"), personality: "besnik" },
      { ...player("player_3", "Bot 3", "ai"), personality: "besnik" },
    ] as Player[];
    activeGames.set(
      ROOM,
      baseGame({
        maxPlayers: 4,
        gameState: finishedHand(seats, ["player_2", "player_1", "player_3", "player_0"]),
        playerMap: { 0: host },
        botSeatsAtStart: new Set([1, 2, 3]),
        matchOver: true,
      })
    );

    const outcome = await applyOrForward(io, {
      kind: "startMatch",
      roomId: ROOM,
      userId: host,
      fillWithBots: true,
    });

    assert.deepEqual(outcome, { ok: true });
    assert.ok(emitted.some((e) => e.event === "game:started"));
    const dealt = activeGames.get(ROOM)!.gameState;
    assert.ok(dealt.exchangePhase, "the new match opened on the 3♠ instead");
    assert.equal(dealt.exchangePhase.winnerIdx, 2);
    assert.equal(dealt.exchangePhase.loserIdx, 0);
    assert.equal(dealt.startCard, undefined);
  });
});

describe("a seatLost that arrives after its player is back", () => {
  for (const gameOver of [false, true]) {
    test(`arms nothing ${gameOver ? "between hands" : "mid-hand"}`, async (t) => {
      const { io, emitted } = stubIo();
      const cluster = {
        in: (room: string) => ({ fetchSockets: async () => (room === "user:besi" ? [{}] : []) }),
      } as unknown as SocketServer;
      setSocketServer(cluster);
      t.after(() => setSocketServer(null as unknown as SocketServer));
      const state = finishedHand(twoHumans(), gameOver ? ["player_0", "player_1"] : []);
      state.gameOver = gameOver;
      activeGames.set(ROOM, baseGame({ gameState: state, playerMap: { 0: "ana", 1: "besi" } }));

      await applyOrForward(io, { kind: "seatLost", roomId: ROOM, userId: "besi" });

      assert.ok(!emitted.some((e) => e.event === "game:player_disconnected"));
      assert.ok(!disconnectTimers.has("besi"), "a disconnect grace no reconnect will clear");
      assert.deepEqual(usersInLobbyGrace(ROOM), []);
    });
  }
});
