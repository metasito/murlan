// A table's writes, in the order they were made: a stalled store holds one snapshot in flight and
// one queued however many moves pile up, and a delete or a status write is never replaced or
// overtaken.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import { activeGames } from "../../server/game/gameRoom.ts";
import { clearRoomTimers } from "../../server/game/gameTimers.ts";
import { closeTable, disposeGame, stopTables, tableWriters } from "../../server/game/gamePersistence.ts";
import { ownsRoom } from "../../server/game/gameOwnership.ts";
import { activeGameStore } from "../../server/store/activeGameStore.ts";
import { roomStore } from "../../server/store/roomStore.ts";
import type { PersistedEnvelope } from "../../shared/persistedEnvelope.ts";
import { startRound } from "../../lib/game/gameEngine.ts";
import { useMemoryTableStores } from "../helpers/memoryTableStores.ts";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { heldRoom } from "../helpers/heldRoom.ts";
import { onlineTable } from "../helpers/onlineTable.ts";

let ROOM = "";
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

/** Marks which snapshot reached the store. */
const stamp = (game: { roundsPlayed: number }, n: number) => void (game.roundsPlayed = n);

const ticks = async (n = 20) => {
  for (let i = 0; i < n; i++) await new Promise((resolve) => setImmediate(resolve));
};

/** The store's `write`, held open until the test lets each one land. */
function heldWrites(t: Parameters<typeof useMemoryTableStores>[0], order: string[]) {
  const pending: (() => void)[] = [];
  const written: PersistedEnvelope[] = [];
  t.mock.method(activeGameStore, "write", (_roomId: string, state: PersistedEnvelope) => {
    order.push(`write:${state.match.roundsPlayed}`);
    written.push(state);
    return new Promise<boolean>((resolve) => pending.push(() => resolve(true)));
  });
  return {
    written,
    landNext: () => pending.shift()?.(),
    get inFlight() {
      return pending.length;
    },
  };
}

test("a hundred snapshots behind a stalled write become one in flight and one queued, the hundredth", async (t) => {
  ROOM = "chain-coalesce";
  useMemoryTableStores(t, { rows: [[ROOM, {}]] });
  const order: string[] = [];
  const writes = heldWrites(t, order);
  const { rt } = recordingRuntime({ persist: "real" });
  await heldRoom(t, ROOM);
  const game = table();

  const promises: Promise<unknown>[] = [];
  let resolved = 0;
  for (let move = 1; move <= 100; move++) {
    stamp(game, move);
    promises.push(rt.writers.persistGameState(ROOM, game).then(() => resolved++));
  }
  await ticks();
  assert.equal(writes.written.length, 1, "more than one snapshot reached the stalled store");
  assert.equal(resolved, 0);

  writes.landNext();
  await ticks();
  assert.equal(writes.written.length, 2);
  assert.equal(writes.written[1].match.roundsPlayed, 100, "the queued write was not the newest snapshot");
  assert.equal(resolved, 1, "a replaced snapshot resolved before its replacement landed");

  writes.landNext();
  await Promise.all(promises);
  assert.equal(resolved, 100);
  assert.deepEqual(order, ["write:1", "write:100"]);
});

test("a delete is never replaced or overtaken, and nothing queued behind it runs first", async (t) => {
  ROOM = "chain-barrier";
  useMemoryTableStores(t, { rows: [[ROOM, {}]] });
  const order: string[] = [];
  const writes = heldWrites(t, order);
  t.mock.method(activeGameStore, "remove", async () => {
    order.push("remove");
    return true;
  });
  const { rt } = recordingRuntime({ persist: "real" });
  await heldRoom(t, ROOM);
  const game = table();

  stamp(game, 1);
  void rt.writers.persistGameState(ROOM, game);
  stamp(game, 2);
  void rt.writers.persistGameState(ROOM, game);
  const discarded = rt.writers.discardGame(ROOM);
  const after = rt.writers.persistGameState(ROOM, game);

  writes.landNext();
  await ticks();
  assert.deepEqual(order, ["write:1", "write:2"], "the delete ran beside the snapshot made before it");
  // Packed as it runs, so what it writes is the table as the delete leaves it.
  stamp(game, 3);
  writes.landNext();
  await discarded;
  await ticks();
  assert.deepEqual(order, ["write:1", "write:2", "remove", "write:3"]);
  writes.landNext();
  await after;
});

test("closing a table marks the room after the snapshot before it and deletes the row after both", async (t) => {
  ROOM = "chain-close";
  useMemoryTableStores(t, { rows: [[ROOM, {}]] });
  const order: string[] = [];
  const writes = heldWrites(t, order);
  t.mock.method(activeGameStore, "remove", async () => {
    order.push("remove");
    return true;
  });
  t.mock.method(roomStore, "updateRoomStatus", async (_roomId: string, status: string) => {
    order.push(`status:${status}`);
  });
  const { rt } = recordingRuntime({ persist: "real" });
  await heldRoom(t, ROOM);
  const game = table();

  stamp(game, 1);
  void rt.writers.persistGameState(ROOM, game);
  closeTable(rt, ROOM, null);
  await ticks();
  assert.deepEqual(order, ["write:1"], "the status write started beside the snapshot before it");

  writes.landNext();
  await ticks();
  assert.deepEqual(order, ["write:1", "status:finished", "remove"]);
});

test("a room kept on disposal is handed back only once its queued writes landed", async (t) => {
  ROOM = "chain-dispose-kept";
  useMemoryTableStores(t, { rows: [[ROOM, {}]] });
  const order: string[] = [];
  const writes = heldWrites(t, order);
  let markLands!: () => void;
  t.mock.method(roomStore, "updateRoomStatus", () => new Promise<void>((resolve) => (markLands = resolve)));
  const { rt } = recordingRuntime({ persist: "real" });
  await heldRoom(t, ROOM);
  let unlocks = 0;
  const query = Client.prototype.query as unknown as (sql: string) => Promise<unknown>;
  t.mock.method(Client.prototype, "query", async (sql: string) => {
    if (/pg_advisory_unlock/.test(sql)) unlocks++;
    return query.call(null, sql);
  });
  const game = table();

  void rt.writers.persistGameState(ROOM, game);
  void rt.writers.updateRoomStatus(ROOM, "finished");
  disposeGame(rt, ROOM, false);
  await ticks();
  assert.equal(unlocks, 0, "the lock went while a write was still in flight");

  writes.landNext();
  await ticks();
  assert.equal(unlocks, 0, "the lock went with a write still queued");
  assert.equal(ownsRoom(ROOM), true);
  markLands();
  await ticks();
  assert.equal(unlocks, 1);
  assert.equal(ownsRoom(ROOM), false);
});

test("stopping the tables waits for the queued snapshot as well as the one in flight", async (t) => {
  ROOM = "chain-stop";
  useMemoryTableStores(t, { rows: [[ROOM, {}]] });
  const order: string[] = [];
  const writes = heldWrites(t, order);
  const store = { games: activeGameStore, rooms: roomStore };
  recordingRuntime();
  await heldRoom(t, ROOM);
  const game = table();
  const writers = tableWriters(store);

  stamp(game, 1);
  void writers.persistGameState(ROOM, game);
  stamp(game, 2);
  void writers.persistGameState(ROOM, game);
  let stopped = false;
  const stopping = stopTables().then(() => (stopped = true));

  writes.landNext();
  await ticks();
  assert.equal(stopped, false, "the tables stopped with a snapshot still queued");
  writes.landNext();
  await stopping;
  assert.deepEqual(order, ["write:1", "write:2"]);
});
