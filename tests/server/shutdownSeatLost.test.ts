// A file of its own: `beginShutdown` cannot be undone inside a process.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Server as SocketServer } from "socket.io";
import { installTableHandlers, applyOrForward } from "../../server/game/tableHandlers.ts";
import { activeGames, beginShutdown } from "../../server/game/gameRoom.ts";
import { clearRoomTimers } from "../../server/game/gameTimers.ts";
import { roomStore } from "../../server/store/roomStore.ts";
import type { OnlineGameState } from "../../server/game/gameRoom.ts";
import type { Player } from "../../lib/game/gameEngine.ts";

const ROOM = "shutdown-seat-lost-room";

const player = (id: string, name: string): Player => ({ id, name, hand: [], type: "human" });

test("a shutdown keeps a between-hands seat, so the vote it held cannot deal without it", async (t) => {
  const emitted: string[] = [];
  const target = { emit: (event: string) => emitted.push(event), timeout: () => target };
  const io = { to: () => target, on: () => {} } as unknown as SocketServer;
  installTableHandlers(io);
  t.mock.method(roomStore, "getRoomById", async () => ({ id: ROOM, gameMode: "free_for_all", maxPlayers: 2 }));
  t.mock.method(roomStore, "updateRoomStatus", async () => {});
  t.mock.method(roomStore, "releaseSeat", async () => null);

  const game = {
    roomId: ROOM,
    joinCode: "AAAAAA",
    gameState: {
      players: [player("player_0", "Ana"), player("player_1", "Besi")],
      currentTurnIndex: 0,
      lastPlayedCombination: null,
      lastPlayedBy: -1,
      passCount: 0,
      gameMode: "free_for_all",
      roundWinner: null,
      gameOver: true,
      rankings: ["player_0", "player_1"],
      firstPlayMade: true,
    },
    playerMap: { 0: "ana", 1: "besi" },
    rematchVotes: new Set(["ana"]),
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
  } as unknown as OnlineGameState;
  activeGames.set(ROOM, game);

  try {
    beginShutdown();
    await applyOrForward(io, { kind: "seatLost", roomId: ROOM, userId: "besi" });
    await new Promise((r) => setTimeout(r, 20));

    assert.deepEqual(game.playerMap, { 0: "ana", 1: "besi" });
    assert.equal(game.gameState.gameOver, true);
    assert.ok(!emitted.includes("game:started"), "a manche was dealt without besi's vote");
  } finally {
    clearRoomTimers(ROOM);
    activeGames.delete(ROOM);
  }
});
