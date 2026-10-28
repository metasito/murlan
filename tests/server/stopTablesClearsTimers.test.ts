// A file of its own: stopping the tables cannot be undone inside a process.
// What a stopped table has armed must not fire against a room that is still in memory, and the
// row writes already queued must land before the process lets go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { arm, clear, pending, seatKey, TIMER_KINDS, type TimerKind } from "../../server/game/gameTimers.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import { tableWriters, stopTables } from "../../server/game/gamePersistence.ts";
import type { TableStore } from "../../server/game/tableRuntime.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { startRound } from "../../lib/game/gameEngine.ts";

const ROOM = "stop-tables-room";
const SEATED = "stop-tables-user";
const SEATS = ["Ana", "B1"].map((name, i) => ({ name, type: "human" as const, id: `player_${i}` }));

const KEY_OF: Record<TimerKind, string> = {
  afk: seatKey(ROOM, SEATED),
  disconnect: SEATED,
  lobbyGrace: seatKey(ROOM, SEATED),
  bot: ROOM,
  autoStart: ROOM,
  voteDeadline: ROOM,
};

test("stopping the tables waits for the row writes already queued, and leaves no timer of any kind armed", async (t) => {
  const game = onlineTable({
    roomId: ROOM,
    playerMap: { 0: SEATED },
    gameState: startRound(SEATS, "free_for_all"),
  });
  activeGames.set(ROOM, game);
  t.after(() => {
    activeGames.delete(ROOM);
    for (const kind of TIMER_KINDS) clear(kind, KEY_OF[kind]);
  });
  let landWrite!: () => void;
  const store = {
    games: { write: () => new Promise<void>((resolve) => (landWrite = resolve)), remove: async () => {} },
    rooms: { updateRoomStatus: async () => {} },
  } as unknown as TableStore;
  void tableWriters(store).persistGameState(ROOM, game);
  for (const kind of TIMER_KINDS) arm(kind, KEY_OF[kind], 60_000, () => {});
  assert.deepEqual(
    TIMER_KINDS.filter((kind) => !pending(kind, KEY_OF[kind])),
    [],
    "a kind was not armed, so its clearing proves nothing"
  );

  let stopped = false;
  const stopping = stopTables().then(() => (stopped = true));
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopped, false, "the tables stopped with a row write still in flight");

  landWrite();
  await stopping;
  assert.deepEqual(
    TIMER_KINDS.filter((kind) => pending(kind, KEY_OF[kind])),
    [],
    "a timer armed on a stopped table is left to fire"
  );
});
