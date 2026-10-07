import { test } from "node:test";
import assert from "node:assert/strict";
import { localGlobalTimeoutMs } from "../../tools/ci/e2eGlobalTimeout.mjs";

const CEIL = 25 * 60_000;
test("CI keeps its job timeout", () => assert.equal(localGlobalTimeoutMs({ CI: "true" }, CEIL), undefined));
test("locally the run stops two minutes under the session's Bash ceiling", () =>
  assert.equal(localGlobalTimeoutMs({}, CEIL), CEIL - 2 * 60_000));
test("0 or garbage cannot switch it off", () => {
  assert.equal(localGlobalTimeoutMs({ E2E_GLOBAL_TIMEOUT_MS: "0" }, CEIL), CEIL - 2 * 60_000);
  assert.equal(localGlobalTimeoutMs({ E2E_GLOBAL_TIMEOUT_MS: "soon" }, CEIL), CEIL - 2 * 60_000);
});
test("in a loop session an override above the ceiling is clamped; one below is kept", () => {
  assert.equal(localGlobalTimeoutMs({ LOOP_TURNS: "200", E2E_GLOBAL_TIMEOUT_MS: String(CEIL * 2) }, CEIL), CEIL - 2 * 60_000);
  assert.equal(localGlobalTimeoutMs({ LOOP_TURNS: "200", E2E_GLOBAL_TIMEOUT_MS: "60000" }, CEIL), 60_000);
});
test("outside a loop session an explicit override above the ceiling is honoured", () => {
  assert.equal(localGlobalTimeoutMs({ E2E_GLOBAL_TIMEOUT_MS: String(CEIL * 2) }, CEIL), CEIL * 2);
  assert.equal(localGlobalTimeoutMs({ LOOP_TURNS: "", E2E_GLOBAL_TIMEOUT_MS: String(CEIL * 2) }, CEIL), CEIL * 2);
});
