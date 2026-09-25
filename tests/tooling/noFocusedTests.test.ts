// A committed `.only` makes jest skip the rest of its file and Playwright the rest of its shard,
// green either way. `forbidOnly` covers the browser suite on CI; this covers every runner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankComments, sourcesUnder } from "../helpers/sourceScan.ts";

const repoRoot = new URL("../..", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const FOCUS = /(?<![\w$])(?:(?:it|test|describe|suite)(?:\.describe)?\.only\s*\(|f(?:it|describe)\s*\(|\bonly\s*:\s*true\b)/g;

export function focused(files: [string, string][]): string[] {
  return files.flatMap(([file, src]) =>
    [...blankComments(src).matchAll(FOCUS)].map((m) => `${file}:${src.slice(0, m.index).split("\n").length}`)
  );
}

test("the scan sees every way to focus a test", () => {
  assert.deepEqual(
    focused([
      ["a.test.ts", 'it.only("x", () => {});\ntest.describe.only("y", () => {});\n'],
      ["b.test.tsx", 'fit("x", () => {});\nfdescribe("y", () => {});\ntest("z", { only: true }, () => {});\n'],
      ["c.test.ts", '// it.only("x")\nconst profit = 1; benefit(2); onlyOnce(); split(".only(");\n'],
    ]),
    ["a.test.ts:1", "a.test.ts:2", "b.test.tsx:1", "b.test.tsx:2", "b.test.tsx:3"]
  );
});

test("the browser suite refuses a focused test on CI", () => {
  assert.match(readFileSync(`${repoRoot}/tests/e2e/playwright.config.ts`, "utf8"), /forbidOnly:\s*!!process\.env\.CI/);
});

test("no test is committed focused", () => {
  const files = sourcesUnder(repoRoot, ["tests", "tools/loop/tests"], /\.tsx?$/).filter(([f]) => !f.endsWith("noFocusedTests.test.ts"));
  assert.ok(files.length > 400, `only ${files.length} test sources found: the walk no longer sees the suites`);
  assert.deepEqual(focused(files), []);
});
