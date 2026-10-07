import { test } from "node:test";
import assert from "node:assert/strict";
import { supervise } from "../run-loop.mjs";
import { RESTART } from "../queue-loop.mjs";

test("a restart code respawns the supervisor; any other ends it", () => {
  const codes = [RESTART, RESTART, 0];
  let spawned = 0;
  assert.equal(supervise(() => (spawned++, codes.shift()!), "x"), 0);
  assert.equal(spawned, 3);
});
test("a failure is not retried", () => {
  let spawned = 0;
  assert.equal(supervise(() => (spawned++, 1), "x"), 1);
  assert.equal(spawned, 1);
});
