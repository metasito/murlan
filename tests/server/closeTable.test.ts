// Closing a table announces it, marks the room finished and disposes it in one
// tick: a table waiting on the database would go on taking moves.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { useMemoryTableStores } from "../helpers/memoryTableStores.ts";
import { closeTable, safeTimer } from "../../server/game/gamePersistence.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import { logger } from "../../server/shared/logger.ts";
import { startRound } from "../../lib/game/gameEngine.ts";
import { eventually } from "../helpers/client.ts";

// One room per test: the first leaves a status write that never settles in its room's queue.
let ROOM = "";
const SEATS = ["Ana", "B1"].map((name, i) => ({ name, type: "human" as const, id: `player_${i}` }));

afterEach(() => activeGames.delete(ROOM));

function liveTable() {
  activeGames.set(ROOM, onlineTable({ roomId: ROOM, playerMap: { 0: "ana" }, gameState: startRound(SEATS, "free_for_all") }));
}

test("announced, then marked finished, then the row deleted — and gone from memory at once", async (t) => {
  ROOM = "close-table-hung";
  useMemoryTableStores(t, { rows: [[ROOM, {}]] });
  const { rt, journal } = recordingRuntime({ persist: "real", writers: { updateRoomStatus: () => new Promise(() => {}) } });
  liveTable();

  closeTable(rt, ROOM, "GAME_INTERRUPTED_EMPTY_SEAT");

  assert.equal(activeGames.has(ROOM), false, "the table stayed in memory while its status was written");
  await eventually(() => journal.some((e) => e.kind !== "send" && e.name === "discardGame"), "the row's discard queued");
  const order = journal.map((e) => (e.kind === "send" ? e.event : e.name));
  assert.deepEqual(order, ["game:notification", "updateRoomStatus", "discardGame"]);
  assert.equal(journal.some((e) => e.kind === "store" && e.name === "remove"), false, "the delete overtook the status write");
});

test("a failed status write is logged and still lets the row go", async (t) => {
  ROOM = "close-table-failed";
  useMemoryTableStores(t, { rows: [[ROOM, {}]] });
  const warned = t.mock.method(logger, "warn", () => undefined);
  const { rt, journal } = recordingRuntime({
    persist: "real",
    writers: {
      updateRoomStatus: async () => {
        throw new Error("connection terminated");
      },
    },
  });
  liveTable();

  closeTable(rt, ROOM, null);
  await eventually(() => journal.some((e) => e.kind === "store" && e.name === "remove"), "the row deleted");

  assert.equal(warned.mock.callCount(), 1);
  assert.ok(journal.some((e) => e.kind === "store" && e.name === "remove"), "the row outlived a failed status write");
  assert.equal(journal.some((e) => e.kind === "send"), false, "a table closed with no notice announced something");
});

test("a timer body that throws closes its table with the server-error notice, and one that does not leaves it be", async (t) => {
  ROOM = "close-table-safe-timer";
  useMemoryTableStores(t, { rows: [[ROOM, {}]] });
  t.mock.method(logger, "error", () => undefined);
  const { rt, events } = recordingRuntime({ persist: "real" });
  liveTable();

  let ran = false;
  safeTimer(rt, "calm", ROOM, () => {
    ran = true;
  });
  assert.equal(ran, true);
  assert.equal(activeGames.has(ROOM), true, "a timer that finished cleanly closed the table");
  assert.deepEqual(events("game:notification"), []);

  safeTimer(rt, "broken", ROOM, () => {
    throw new Error("boom");
  });
  assert.equal(activeGames.has(ROOM), false, "a throwing timer left a table nothing will re-arm");
  assert.equal(events("game:notification").length, 1);
  assert.match(JSON.stringify(events("game:notification")[0]), /GAME_INTERRUPTED_SERVER_ERROR/);
});
