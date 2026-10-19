// A file of its own: `beginShutdown` cannot be undone inside a process.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Server as SocketServer } from "socket.io";
import { installTableHandlers, applyOrForward } from "../../server/game/tableHandlers.ts";
import { activeGames, beginShutdown } from "../../server/game/gameRoom.ts";
import { clearRoomTimers } from "../../server/game/gameTimers.ts";
import { roomStore } from "../../server/store/roomStore.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { seat, state } from "../support/game.ts";

const ROOM = "shutdown-seat-lost-room";

test("a shutdown keeps a between-hands seat, so the vote it held cannot deal without it", async (t) => {
  const emitted: string[] = [];
  const target = { emit: (event: string) => emitted.push(event), timeout: () => target };
  const io = { to: () => target, on: () => {} } as unknown as SocketServer;
  installTableHandlers(io);
  t.mock.method(roomStore, "getRoomById", async () => ({ id: ROOM, gameMode: "free_for_all", maxPlayers: 2 }));
  t.mock.method(roomStore, "updateRoomStatus", async () => {});
  t.mock.method(roomStore, "releaseSeat", async () => null);

  const game = onlineTable({
    roomId: ROOM,
    gameState: state({
      players: [seat(0, [], { name: "Ana" }), seat(1, [], { name: "Besi" })],
      lastPlayedBy: -1,
      roundOver: true,
      finishingOrder: ["p0", "p1"],
      firstPlayMade: true,
    }),
    playerMap: { 0: "ana", 1: "besi" },
    rematchVotes: new Set(["ana"]),
    maxPlayers: 2,
    roundsPlayed: 1,
  });
  activeGames.set(ROOM, game);

  try {
    beginShutdown();
    await applyOrForward(io, { kind: "seatLost", roomId: ROOM, userId: "besi" });
    await new Promise((r) => setTimeout(r, 20));

    assert.deepEqual(game.playerMap, { 0: "ana", 1: "besi" });
    assert.equal(game.gameState.roundOver, true);
    assert.ok(!emitted.includes("game:started"), "a round was dealt without besi's vote");
  } finally {
    clearRoomTimers(ROOM);
    activeGames.delete(ROOM);
  }
});
