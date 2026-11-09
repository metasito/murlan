// A file of its own: closing the database cannot be undone inside a process.
// `shutdownBudget.test.ts` trusts these three callees to end by the budget they are handed; this proves it
// with a dependency that never finishes, on mocked time.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { closeDatabase, adminPool, openDatabase, pool } from "../../server/store/db.ts";
import { settleInFlight, track } from "../../server/shared/inFlight.ts";
import { closeTableOwners } from "../../server/store/tableOwners.ts";
import { logger } from "../../server/shared/logger.ts";
import { SELF_BOUNDED } from "../helpers/selfBounded.ts";

const MARGIN_MS = 50;
const STEP_MS = 25;

async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** Advances mocked time in steps until `work` settles; returns how much it took. */
async function elapsed(t: TestContext, work: Promise<unknown>, ceilingMs: number): Promise<number> {
  let done = false;
  void work.then(() => (done = true));
  let spent = 0;
  await flush();
  while (!done && spent < ceilingMs) {
    t.mock.timers.tick(STEP_MS);
    spent += STEP_MS;
    await flush();
  }
  assert.ok(done, `still waiting after ${ceilingMs}ms`);
  return spent;
}

/** One proof per callee in SELF_BOUNDED, run in this order: closing the database comes last. */
const PROOFS: Record<string, (t: TestContext) => Promise<void>> = {
  async settleInFlight(t) {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    void track(new Promise<void>(() => {}));
    assert.ok((await elapsed(t, settleInFlight(100), 1_000)) <= 100 + MARGIN_MS);
  },
  async closeTableOwners(t) {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    void track(new Promise<void>(() => {}));
    assert.ok((await elapsed(t, closeTableOwners(100), 1_000)) <= 100 + MARGIN_MS);
  },
  async closeDatabase(t) {
    openDatabase();
    for (const p of [pool(), adminPool()]) {
      t.mock.getter(p, "totalCount", () => 1);
      t.mock.getter(p, "idleCount", () => 0);
      t.mock.method(p, "end", async () => {});
    }
    t.mock.method(logger, "error", () => {});
    t.mock.method(logger, "warn", () => {});
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    assert.ok((await elapsed(t, closeDatabase({ drainMs: 300 }), 5_000)) <= 300 + MARGIN_MS);
  },
};

test("every callee shutdownBudget trusts has exactly one proof here, and no proof is for a callee it does not trust", () => {
  assert.deepEqual(Object.keys(PROOFS).sort(), Object.keys(SELF_BOUNDED).sort());
});

for (const [name, proof] of Object.entries(PROOFS)) {
  test(`${name} gives up at its budget on work that never finishes`, (t) => proof(t));
}

test("plant: a callee that ignores its budget turns a proof red", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await assert.rejects(elapsed(t, new Promise<void>(() => {}), 1_000), /still waiting after 1000ms/);
});
