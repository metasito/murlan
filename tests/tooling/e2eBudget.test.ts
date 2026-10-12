import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import BudgetReporter, { committedTimings, HARD_FACTOR, overBudget, RATIO, SLACK_S } from "../../tools/ci/e2e-budget.mjs";

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
  const dir = mkdtempSync(path.join(tmpdir(), "e2e-budget-"));
  const listFile = path.join(dir, "over-budget.json");
  const reporter = new BudgetReporter({ out: listFile });
  reporter.onBegin({ projects: [{ testDir }] });
  for (const [file, list] of Object.entries(durations)) {
    list.forEach((duration, i) => {
      const s = skipped.includes(file) ? "skipped" : "passed";
      reporter.onTestEnd({ id: `${file}#${i}`, location: { file: path.join(testDir, file) } }, { status: s, duration });
    });
  }
  const prior = process.env.CI;
  process.env.CI = "1";
  const write = process.stdout.write;
  let out = "";
  process.stdout.write = ((chunk: string) => ((out += chunk), true)) as typeof process.stdout.write;
  try {
    const verdict = reporter.onEnd({ status });
    const listed = existsSync(listFile) ? JSON.parse(readFileSync(listFile, "utf8")) : undefined;
    return { verdict, out, listed };
  } finally {
    process.stdout.write = write;
    if (prior === undefined) delete process.env.CI;
    else process.env.CI = prior;
    rmSync(dir, { recursive: true, force: true });
  }
}

const timings = committedTimings();
const [priced, seconds] = Object.entries(timings)[0]!;

test("a spec over its budget warns by name and leaves the shard green", () => {
  const ms = (seconds * RATIO + SLACK_S + 5) * 1000;
  const { verdict, out } = run({ [priced]: [ms / 2, ms / 2] });
  assert.equal(verdict, undefined);
  assert.match(out, new RegExp(`::warning::${priced.replace(/\./g, "\\.")} took`));
});

test("a green shard lists each spec over budget, repo-relative, for the land gate; a spec with no recorded time is not listed", () => {
  const ms = (seconds * RATIO + SLACK_S + 5) * 1000;
  const { listed } = run({ [priced]: [ms], "brandNew.spec.ts": [1e9] });
  assert.deepEqual(listed, [{ file: `tests/e2e/${priced}`, seconds: Math.round(ms / 100) / 10, budget: seconds * RATIO + SLACK_S }]);
  assert.deepEqual(run({ [priced]: [1000] }).listed, []);
});

test("each browser shard uploads the list from the runner's temp directory, and a green shard without one is red", () => {
  const prior = process.env.RUNNER_TEMP;
  process.env.RUNNER_TEMP = path.join(repoRoot, "runner-temp");
  try {
    assert.equal(new BudgetReporter().out, path.join(repoRoot, "runner-temp", "over-budget.json"));
  } finally {
    if (prior === undefined) delete process.env.RUNNER_TEMP;
    else process.env.RUNNER_TEMP = prior;
  }
  const ci = readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8");
  const browser = /^ {2}browser:\n([\s\S]*?)(?=^ {2}\S)/m.exec(ci.replace(/^\s*#.*\n/gm, ""))?.[1] ?? "";
  assert.match(browser, /upload-artifact@\S+.*\n\s+with:\n\s+name: over-budget-browser-\$\{\{ matrix\.shard \}\}\n\s+path: \$\{\{ runner\.temp \}\}\/over-budget\.json\n\s+if-no-files-found: error\n/);
});

test("the reporter fails a green shard whose spec took over HARD_FACTOR times its budget, and names it", () => {
  const ms = ((seconds * RATIO + SLACK_S) * HARD_FACTOR + 5) * 1000;
  const { verdict, out } = run({ [priced]: [ms / 2, ms / 2] });
  assert.deepEqual(verdict, { status: "failed" });
  assert.match(out, new RegExp(`::error::${priced.replace(/\./g, "\\.")} took`));
  assert.ok(HARD_FACTOR <= 3, `HARD_FACTOR ${HARD_FACTOR}`);
});

test("a retried test is charged its slowest attempt, not every attempt", () => {
  const budgetMs = (seconds * RATIO + SLACK_S) * 1000;
  const retried = (first: number, retry: number) => {
    const reporter = new BudgetReporter();
    reporter.onBegin({ projects: [{ testDir }] });
    const t = { id: "retried", location: { file: path.join(testDir, priced) } };
    reporter.onTestEnd(t, { status: "failed", duration: first, retry: 0 });
    reporter.onTestEnd(t, { status: "passed", duration: retry, retry: 1 });
    return reporter.ms[priced];
  };
  assert.equal(retried(budgetMs * 0.6, budgetMs * 0.7), budgetMs * 0.7);
  assert.equal(retried(budgetMs * 1.1, budgetMs * 0.2), budgetMs * 1.1);
});

test("a test a helper declares is charged to the spec file that calls the helper", () => {
  const reporter = new BudgetReporter();
  reporter.onBegin({ projects: [{ testDir }] });
  const fileSuite = { type: "file", location: { file: path.join(testDir, priced) } };
  const declared = { location: { file: path.join(testDir, "helpers", "grid.ts") }, parent: { type: "describe", parent: fileSuite } };
  reporter.onTestEnd(declared, { status: "passed", duration: 1 });
  assert.deepEqual(Object.keys(reporter.ms), [priced]);
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

test("a blocking spec is never retried, and its failure keeps its trace and video", () => {
  const config = readFileSync(path.join(testDir, "playwright.config.ts"), "utf8");
  assert.match(config, /^ {2}retries: 0,$/m);
  assert.match(config, /^ {4}trace: "retain-on-failure",$/m);
  assert.match(config, /^ {4}video: "retain-on-failure",$/m);
});

test("timings.json prices enough of the suite for the budget to mean something", () => {
  assert.ok(Object.keys(timings).length >= 40, `only ${Object.keys(timings).length} specs are priced`);
});
