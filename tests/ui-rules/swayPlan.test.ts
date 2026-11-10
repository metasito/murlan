// tests/ui-rules/swayPlan.test.ts — every platform draws the sway as today until a PR 0 row says otherwise.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SWAY_PLAN, swayShape } from "../../components/table/swayPlan.ts";

test("every platform is on N0", () => {
  assert.deepEqual(SWAY_PLAN, { web: "N0", ios: "N0", android: "N0" });
});

test("a platform the plan does not name falls back to N0", () => {
  assert.equal(swayShape("windows"), "N0");
  assert.equal(swayShape("web"), "N0");
});
