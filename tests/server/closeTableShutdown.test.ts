// A file of its own: stopping the tables cannot be undone inside a process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { useMemoryTableStores } from "../helpers/memoryTableStores.ts";
import { closeTable } from "../../server/game/gamePersistence.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import { startRound } from "../../lib/game/gameEngine.ts";

const ROOM = "close-table-shutdown-room";
const SEATS = ["Ana", "B1"].map((name, i) => ({ name, type: "human" as const, id: `player_${i}` }));

test("a shutdown waits for a closed table's status write and row delete", async (t) => {
  const { rows } = useMemoryTableStores(t, { rows: [[ROOM, {}]] });
  let marked = false;
  const { rt } = recordingRuntime({
    persist: "real",
    writers: {
      updateRoomStatus: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        marked = true;
      },
    },
  });
  activeGames.set(ROOM, onlineTable({ roomId: ROOM, playerMap: { 0: "ana" }, gameState: startRound(SEATS, "free_for_all") }));

  closeTable(rt, ROOM, null);
  await rt.stopTables();

  assert.equal(marked, true, "the shutdown went on before the room was marked finished");
  assert.equal(rows.has(ROOM), false, "the shutdown went on before the row was deleted");
});
