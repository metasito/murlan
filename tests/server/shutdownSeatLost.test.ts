// A file of its own: `beginShutdown` cannot be undone inside a process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { applyOrForward } from "../../server/game/tableRouter.ts";
import { activeGames, beginShutdown } from "../../server/game/gameRoom.ts";
import { clearRoomTimers } from "../../server/game/gameTimers.ts";
import { roomStore } from "../../server/store/roomStore.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { seat, state } from "../support/game.ts";

const ROOM = "shutdown-seat-lost-room";

test("a shutdown keeps a between-hands seat, so the vote it held cannot deal without it", async (t) => {
  const { rt, sent } = recordingRuntime();
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
    await applyOrForward(rt, { kind: "seatLost", roomId: ROOM, userId: "besi" });
    await new Promise((r) => setTimeout(r, 20));

    assert.deepEqual(game.playerMap, { 0: "ana", 1: "besi" });
    assert.equal(game.gameState.roundOver, true);
    assert.ok(!sent.some((e) => e.event === "game:started"), "a round was dealt without besi's vote");
  } finally {
    clearRoomTimers(ROOM);
    activeGames.delete(ROOM);
  }
});
