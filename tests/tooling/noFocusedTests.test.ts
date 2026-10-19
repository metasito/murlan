// A committed `.only` makes jest skip the rest of its file and Playwright the rest of its shard,
// green either way. `forbidOnly` covers the browser suite on CI; the `no-focused-test` guard in
// eslint.guards.cjs covers every runner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const repoRoot = new URL("../..", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");

test("the browser suite refuses a focused test on CI", () => {
  assert.match(readFileSync(`${repoRoot}/tests/e2e/playwright.config.ts`, "utf8"), /forbidOnly:\s*!!process\.env\.CI/);
});
