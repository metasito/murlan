import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { dealRound } from "../../server/game/dealRound.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import { clearRoomTimers } from "../../server/game/gameTimers.ts";
import { activeGameStore } from "../../server/store/activeGameStore.ts";
import { roomStore } from "../../server/store/roomStore.ts";
import { startRound } from "../../lib/game/gameEngine.ts";

const ROOM = "deal-round-writers-room";
const SEATS = [0, 1, 2, 3].map((i) => ({ name: `B${i}`, type: "bot" as const, id: `player_${i}` }));

afterEach(() => {
  clearRoomTimers(ROOM);
  activeGames.delete(ROOM);
});

test("a deal writes the room's status and its row through the runtime's writers alone", async (t) => {
  const bypassed: string[] = [];
  t.mock.method(roomStore, "updateRoomStatus", async () => void bypassed.push("roomStore.updateRoomStatus"));
  t.mock.method(activeGameStore, "write", async () => void bypassed.push("activeGameStore.write"));
  const { rt, writes } = recordingRuntime();
  const game = onlineTable({ roomId: ROOM, gameState: startRound(SEATS, "free_for_all") });
  activeGames.set(ROOM, game);

  await dealRound(rt, game, startRound(SEATS, "free_for_all"));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(bypassed, [], "the deal reached a store past rt.writers");
  assert.deepEqual(
    writes("updateRoomStatus").map((w) => w.args),
    [[ROOM, "in_progress"]]
  );
  assert.deepEqual(
    writes("persistGameState").map((w) => w.args),
    [[ROOM, game]]
  );
});
