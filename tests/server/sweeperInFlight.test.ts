// A sweep still running when the next interval fires is not joined by a second one on the
// same instance: the deletes are batched to stay inside the statement timeout, and two
// sweeps racing over one backlog double the load that batching bounds.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SQL } from "drizzle-orm";
import { db, openDatabase } from "../../server/store/db.ts";
import { startSweeper } from "../../server/game/gamePersistence.ts";
import { sweepIntervalMs } from "../../server/game/gameTimers.ts";
import type { TableRuntime } from "../../server/game/tableRuntime.ts";

openDatabase();

/** Lets a sweep whose orphans have resumed run its mocked queries to the end. */
async function settle() {
  for (let i = 0; i < 200; i++) await new Promise((resolve) => setImmediate(resolve));
}

test("a tick that lands while the last sweep runs starts nothing", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  t.mock.method(db(), "execute", async (_q: SQL) => ({ rows: [], rowCount: 0 }));

  let started = 0;
  let finish: () => void = () => {};
  const resumeOrphans = () => {
    started++;
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  };
  startSweeper({} as TableRuntime, resumeOrphans);
  startSweeper({} as TableRuntime, resumeOrphans);

  t.mock.timers.tick(sweepIntervalMs());
  t.mock.timers.tick(sweepIntervalMs());
  assert.equal(started, 1, "the second tick joined a sweep still in flight");

  finish();
  await settle();
  t.mock.timers.tick(sweepIntervalMs());
  assert.equal(started, 2, "a sweep that finished leaves the next tick free to run");
  finish();
  await settle();
});
