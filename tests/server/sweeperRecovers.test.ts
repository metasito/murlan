// A file of its own: a process has one sweeper. A sweep that threw must not be the last one:
// the tick after it still resumes ownerless tables and drops the finished ones, and a game held
// for a room this instance has no claim on is reported.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SQL } from "drizzle-orm";
import { db, openDatabase } from "../../server/store/db.ts";
import { startSweeper } from "../../server/game/gamePersistence.ts";
import { sweepIntervalMs } from "../../server/game/gameTimers.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import { logger } from "../../server/shared/logger.ts";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { startRound } from "../../lib/game/gameEngine.ts";

openDatabase();

async function settle() {
  for (let i = 0; i < 200; i++) await new Promise((resolve) => setImmediate(resolve));
}

test("a sweep that throws leaves the next tick free to sweep, finished tables included", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  t.mock.method(db(), "execute", async (_q: SQL) => ({ rows: [], rowCount: 0 }));
  const errors = t.mock.method(logger, "error", () => undefined);
  const reportedRooms = () =>
    errors.mock.calls.flatMap((c) => {
      const { rooms } = c.arguments[0] as { rooms?: string[] };
      return rooms ? [rooms] : [];
    });
  const seats = ["Ana", "Besi"].map((name, i) => ({ name, type: "human" as const, id: `player_${i}` }));
  const room = "sweeper-recovers-room";
  activeGames.set(
    room,
    onlineTable({
      roomId: room,
      playerMap: { 0: "ana" },
      gameState: { ...startRound(seats, "free_for_all"), roundOver: true },
    })
  );
  t.after(() => activeGames.delete(room));

  let ticks = 0;
  const resumeOrphans = () => {
    ticks++;
    if (ticks === 1) throw new Error("the store was not ready");
    return Promise.resolve();
  };
  const { rt } = recordingRuntime();
  startSweeper(rt, resumeOrphans);

  t.mock.timers.tick(sweepIntervalMs());
  await settle();
  assert.equal(ticks, 1);
  assert.deepEqual(reportedRooms(), [[room]], "a game held without a claim on its room went unreported");

  t.mock.timers.tick(sweepIntervalMs());
  await settle();
  assert.equal(ticks, 2, "a sweep that threw stopped every sweep after it");
  assert.equal(activeGames.has(room), false, "the finished table nobody is at was not dropped");

  const reported = reportedRooms().length;
  t.mock.timers.tick(sweepIntervalMs());
  await settle();
  assert.equal(reportedRooms().length, reported, "a sweep with every game claimed reported a room");
});
