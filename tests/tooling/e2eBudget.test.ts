import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import BudgetReporter, { committedTimings, overBudget, RATIO, SLACK_S } from "../../tools/ci/e2e-budget.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const testDir = path.join(repoRoot, "tests", "e2e");

test("a spec past twice its measured time plus the slack is named; one within it is not", () => {
  assert.deepEqual(overBudget({ "slow.spec.ts": 71, "fine.spec.ts": 69, "new.spec.ts": 999 }, { "slow.spec.ts": 20, "fine.spec.ts": 20 }), [
    { file: "slow.spec.ts", seconds: 71, budget: 70 },
  ]);
});

test("the budget cannot be loosened past twice the measurement and half a minute", () => {
  assert.ok(RATIO <= 2 && SLACK_S <= 30, `RATIO ${RATIO}, SLACK_S ${SLACK_S}`);
});

function run(durations: Record<string, number[]>, status = "passed", skipped: string[] = []) {
  const reporter = new BudgetReporter();
  reporter.onBegin({ projects: [{ testDir }] });
  for (const [file, list] of Object.entries(durations)) {
    for (const duration of list) {
      const s = skipped.includes(file) ? "skipped" : "passed";
      reporter.onTestEnd({ location: { file: path.join(testDir, file) } }, { status: s, duration });
    }
  }
  const prior = process.env.CI;
  process.env.CI = "1";
  const write = process.stdout.write;
  let out = "";
  process.stdout.write = ((chunk: string) => ((out += chunk), true)) as typeof process.stdout.write;
  try {
    return { verdict: reporter.onEnd({ status }), out };
  } finally {
    process.stdout.write = write;
    if (prior === undefined) delete process.env.CI;
    else process.env.CI = prior;
  }
}

const timings = committedTimings();
const [priced, seconds] = Object.entries(timings)[0]!;

test("the reporter fails a green shard whose spec blew its budget, and names it", () => {
  const ms = (seconds * RATIO + SLACK_S + 5) * 1000;
  const { verdict, out } = run({ [priced]: [ms / 2, ms / 2] });
  assert.deepEqual(verdict, { status: "failed" });
  assert.match(out, new RegExp(`::error::${priced.replace(/\./g, "\\.")} took`));
});

test("a test a helper declares is charged to the spec file that calls the helper", () => {
  const reporter = new BudgetReporter();
  reporter.onBegin({ projects: [{ testDir }] });
  const fileSuite = { type: "file", location: { file: path.join(testDir, priced) } };
  const declared = { location: { file: path.join(testDir, "helpers", "grid.ts") }, parent: { type: "describe", parent: fileSuite } };
  reporter.onTestEnd(declared, { status: "passed", duration: 1 });
  assert.deepEqual(Object.keys(reporter.ms), [priced]);
});

test("a retried test is charged its last attempt, as timings.json prices it", () => {
  const reporter = new BudgetReporter();
  reporter.onBegin({ projects: [{ testDir }] });
  const flaky = { location: { file: path.join(testDir, priced) } };
  reporter.onTestEnd(flaky, { status: "failed", duration: (seconds * RATIO + SLACK_S + 5) * 1000 });
  reporter.onTestEnd(flaky, { status: "passed", duration: seconds * 1000 });
  assert.deepEqual(reporter.ms, { [priced]: seconds * 1000 });
});

test("the reporter leaves a spec within budget, a skipping spec and an already red run alone", () => {
  assert.equal(run({ [priced]: [seconds * 1000] }).verdict, undefined);
  assert.equal(run({ [priced]: [1e9] }, "passed", [priced]).verdict, undefined);
  assert.equal(run({ [priced]: [1e9] }, "failed").verdict, undefined);
});

test("CI runs the budget", () => {
  const config = readFileSync(path.join(testDir, "playwright.config.ts"), "utf8");
  assert.match(config, /process\.env\.CI\s*\?\s*\[[^\n]*tools\/ci\/e2e-budget\.mjs/);
});

test("timings.json prices enough of the suite for the budget to mean something", () => {
  assert.ok(Object.keys(timings).length >= 40, `only ${Object.keys(timings).length} specs are priced`);
});
