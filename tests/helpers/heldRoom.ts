// A room this process holds, as a takeover leaves it, for unit tests with no Postgres: the lock
// is scripted unless the test scripts it itself, and the claim's row comes from the stores the
// ownership was opened with (`useMemoryTableStores`, or `activeGameStore` mocked by the test).
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import { claimRoom, enterTable, ownsRoom, releaseRoom } from "../../server/game/gameOwnership.ts";
import { rehydrateGame } from "../../server/game/tableLifecycle.ts";
import { activeGameStore } from "../../server/store/activeGameStore.ts";

function scriptLock(t: TestContext): void {
  if ((Client.prototype.query as { mock?: unknown }).mock) return;
  t.mock.method(Client.prototype, "connect", async () => {});
  t.mock.method(Client.prototype, "end", async () => {});
  t.mock.method(Client.prototype, "query", async (sql: string) =>
    /pg_try_advisory_lock/.test(sql) ? { rows: [{ locked: true }] } : { rows: [] }
  );
}

/** Claimed, not entered: what `rehydrateGame` is handed. */
export async function claimedRoom(t: TestContext, roomId: string): Promise<void> {
  scriptLock(t);
  assert.equal(await claimRoom(roomId), true, "the scripted lock refused the claim");
  t.after(() => releaseRoom(roomId));
}

/**
 * Claimed and entered: what a table in memory runs under. Over `useMemoryTableStores` the claim
 * moves the memory row's epoch; otherwise it answers once from here, at `epoch`, with a row
 * unless `row` is false.
 */
export async function heldRoom(t: TestContext, roomId: string, { epoch = 1, row = true } = {}): Promise<void> {
  await claimedRoom(t, roomId);
  if (!(activeGameStore.claim as { mock?: unknown }).mock) {
    t.mock.method(
      activeGameStore,
      "claim",
      async () => ({ epoch, row: row ? { roomId, gameState: {} } : undefined }),
      { times: 1 }
    );
  }
  assert.equal((await enterTable(roomId)).held, true, "the claimed room could not be entered");
}

/** `rehydrateGame` as a takeover calls it: under a claim. */
export async function rehydrateClaimed(t: TestContext, ...args: Parameters<typeof rehydrateGame>) {
  if (!ownsRoom(args[1])) await claimedRoom(t, args[1]);
  return rehydrateGame(...args);
}
