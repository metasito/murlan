import { test } from "node:test";
import assert from "node:assert/strict";
import { allLimited, adminQueryLimit } from "../../server/http/admin.ts";
import { POOL_MAX } from "../../server/store/db.ts";

test("the admin page leaves most of the pool to the tables", () => {
  assert.equal(adminQueryLimit(10), 4);
  assert.equal(adminQueryLimit(1), 1);
  assert.equal(adminQueryLimit(2), 1);
  for (const max of [1, 2, 3, 5, 10, 40]) assert.ok(adminQueryLimit(max) <= Math.max(1, max / 2), String(max));
  assert.ok(adminQueryLimit(POOL_MAX) < POOL_MAX);
});

test("allLimited never runs more than its limit, and answers in order", async () => {
  let running = 0;
  let peak = 0;
  const task = (value: number) => async () => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 1 + (value % 3)));
    running -= 1;
    return value;
  };
  const results = await allLimited(3, [task(0), task(1), task(2), task(3), task(4), task(5), task(6)] as const);
  assert.deepEqual(results, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(peak, 3);
});

test("allLimited rejects with the first failure", async () => {
  await assert.rejects(
    allLimited(2, [async () => 1, async () => Promise.reject(new Error("boom")), async () => 3] as const),
    /boom/
  );
});
