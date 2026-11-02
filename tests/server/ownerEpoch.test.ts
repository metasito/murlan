// A table's row is written only under the epoch its claim moved it to: a probe moves nothing,
// a claim moves it once, and a write the row refuses ends the table with nothing more written.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { enterTable, ownsRoom } from "../../server/game/gameOwnership.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import { clearRoomTimers } from "../../server/game/gameTimers.ts";
import { startRound } from "../../lib/game/gameEngine.ts";
import { useMemoryTableStores } from "../helpers/memoryTableStores.ts";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { claimedRoom } from "../helpers/heldRoom.ts";
import { onlineTable } from "../helpers/onlineTable.ts";

const ROOM = "owner-epoch-room";
const SEATS = ["Ana", "B1"].map((name, i) => ({ name, type: "human" as const, id: `player_${i}` }));

afterEach(() => {
  clearRoomTimers(ROOM);
  activeGames.delete(ROOM);
});

const table = () => {
  const game = onlineTable({ roomId: ROOM, playerMap: { 0: "ana" }, gameState: startRound(SEATS, "free_for_all") });
  activeGames.set(ROOM, game);
  return game;
};

test("a claim that only probes moves no epoch; entering moves it once", async (t) => {
  const { epochs } = useMemoryTableStores(t, { rows: [[ROOM, { probe: true }]] });
  recordingRuntime();
  await claimedRoom(t, ROOM);
  assert.equal(epochs.get(ROOM), 0, "the lock alone moved the row's epoch");

  const entered = await enterTable(ROOM);
  assert.deepEqual(entered, { held: true, row: { roomId: ROOM, gameState: { probe: true } } });
  assert.equal(epochs.get(ROOM), 1);
  assert.equal((await enterTable(ROOM)).held, true);
  assert.equal(epochs.get(ROOM), 1, "entering a room already entered moved its epoch again");
});

test("a room this process does not hold is not entered, and its row is not moved", async (t) => {
  const { epochs } = useMemoryTableStores(t, { rows: [[ROOM, {}]] });
  recordingRuntime();
  assert.deepEqual(await enterTable(ROOM), { held: false });
  assert.equal(epochs.get(ROOM), 0);
});

test("a claim with no row enters at epoch 1, and its first write inserts the row at 1", async (t) => {
  const { rows, epochs } = useMemoryTableStores(t);
  const { rt } = recordingRuntime({ persist: "real" });
  await claimedRoom(t, ROOM);
  assert.deepEqual(await enterTable(ROOM), { held: true, row: undefined });

  await rt.writers.persistGameState(ROOM, table());
  assert.ok(rows.has(ROOM), "the first write of a new table wrote nothing");
  assert.equal(epochs.get(ROOM), 1);
});

test("a write the row refuses ends the table once, and nothing more is written", async (t) => {
  const { rows, epochs } = useMemoryTableStores(t, { rows: [[ROOM, { before: true }]] });
  const { rt, journal } = recordingRuntime({ persist: "real" });
  await claimedRoom(t, ROOM);
  await enterTable(ROOM);
  const game = table();
  epochs.set(ROOM, 2);

  await rt.writers.persistGameState(ROOM, game);
  assert.equal(activeGames.has(ROOM), false, "the table played on after another claim took its row");
  assert.equal(ownsRoom(ROOM), false);
  await rt.writers.discardGame(ROOM);
  await rt.writers.persistGameState(ROOM, game);

  assert.deepEqual(rows.get(ROOM), { before: true });
  assert.equal(epochs.get(ROOM), 2);
  const landed = journal.filter((e) => e.kind === "store").map((e) => e.name);
  assert.deepEqual(landed, ["write"], "something was written after the table was lost");
});

test("deleting a row that is already gone is no loss", async (t) => {
  useMemoryTableStores(t);
  const { rt } = recordingRuntime({ persist: "real" });
  await claimedRoom(t, ROOM);
  await enterTable(ROOM);
  table();

  await rt.writers.discardGame(ROOM);
  assert.equal(activeGames.has(ROOM), true, "a delete that found no row of this claim's ended the table");
  assert.equal(ownsRoom(ROOM), true);
});

test("a row deleted under a live table, as an account deletion purges the host's rooms, is written again", async (t) => {
  const { rows, epochs } = useMemoryTableStores(t, { rows: [[ROOM, { before: true }]] });
  const { rt } = recordingRuntime({ persist: "real" });
  await claimedRoom(t, ROOM);
  await enterTable(ROOM);
  const game = table();
  rows.delete(ROOM);
  epochs.delete(ROOM);

  await rt.writers.persistGameState(ROOM, game);
  assert.equal(activeGames.has(ROOM), true, "the table was ended for a row nobody else claimed");
  assert.ok(rows.has(ROOM));
  assert.equal(epochs.get(ROOM), 1);
});
