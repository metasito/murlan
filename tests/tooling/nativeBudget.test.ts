import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import NativeBudgetReporter, { BUDGET_S, EXCEPTIONS, MAX_EXCEPTION_S, overBudget } from "../../tools/ci/native-budget.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const exceptions: Record<string, { seconds: number; why: string }> = EXCEPTIONS;

function run(files: Record<string, number[]>, failedSuites = 0) {
  const reporter = new NativeBudgetReporter({ rootDir: repoRoot });
  for (const [key, durations] of Object.entries(files)) {
    const [project, file] = key.split(/:(.*)/s);
    reporter.onTestResult(
      { context: { config: { displayName: { name: project } } } },
      { testFilePath: path.join(repoRoot, file), testResults: durations.map((duration) => ({ duration })) }
    );
  }
  const write = process.stdout.write;
  let out = "";
  process.stdout.write = ((chunk: string) => ((out += chunk), true)) as typeof process.stdout.write;
  try {
    reporter.onRunComplete(new Set(), { numFailedTestSuites: failedSuites });
  } finally {
    process.stdout.write = write;
  }
  return { error: reporter.getLastError(), out };
}

const ms = (seconds: number) => seconds * 1000;

test("a file whose cases outlast the budget is named; one within it, or within its own exception, is not", () => {
  const [excepted, { seconds }] = Object.entries(exceptions)[0]!;
  assert.deepEqual(overBudget({ "ios:a.test.tsx": BUDGET_S + 1, "android:a.test.tsx": BUDGET_S, [excepted]: seconds }), [
    { file: "ios:a.test.tsx", seconds: BUDGET_S + 1, budget: BUDGET_S },
  ]);
  assert.equal(overBudget({ [excepted]: seconds + 1 }).length, 1);
});

test("the reporter fails a green run with a file over budget, summing its cases, and names the file and project", () => {
  const { error, out } = run({ "ios:tests/native/x.test.tsx": [ms(BUDGET_S), ms(1)], "android:tests/native/x.test.tsx": [ms(1)] });
  assert.ok(error instanceof Error);
  assert.match(out, /::error::ios:tests\/native\/x\.test\.tsx took/);
  assert.doesNotMatch(out, /::error::android:/);
});

test("the reporter passes a run within budget and leaves an already red run alone", () => {
  assert.equal(run({ "ios:tests/native/x.test.tsx": [ms(1)] }).error, undefined);
  assert.equal(run({ "ios:tests/native/x.test.tsx": [ms(BUDGET_S * 9)] }, 1).error, undefined);
});

test("a run that measured no file, or no time in any, is red, red run or not", () => {
  assert.ok(run({}).error instanceof Error);
  assert.ok(run({}, 1).error instanceof Error);
  assert.ok(run({ "ios:tests/native/x.test.tsx": [0] }).error instanceof Error);
});

test("the budget cannot be loosened past what was measured, nor an exception past a minute", () => {
  assert.ok(BUDGET_S <= 15, `BUDGET_S ${BUDGET_S}`);
  assert.ok(MAX_EXCEPTION_S <= 60, `MAX_EXCEPTION_S ${MAX_EXCEPTION_S}`);
});

test("each exception names a native file and a project, says why, and grants more than the budget and no more than the cap", () => {
  for (const [key, { seconds, why }] of Object.entries(exceptions)) {
    const [project, file] = key.split(/:(.*)/s);
    assert.ok(project === "ios" || project === "android", `${key}: unknown project`);
    assert.ok(file.startsWith("tests/native/") && existsSync(path.join(repoRoot, file)), `${key}: no such file`);
    assert.ok(why.length > 20, `${key}: no reason`);
    assert.ok(seconds > BUDGET_S && seconds <= MAX_EXCEPTION_S, `${key}: ${seconds}s`);
  }
});

test("CI runs the budget over the native suite, and nothing else does", () => {
  const reporters = (ci: string | undefined) => {
    const { CI: _ci, ...env }: NodeJS.ProcessEnv = process.env;
    if (ci !== undefined) env.CI = ci;
    const out = execFileSync(process.execPath, ["-e", "console.log(JSON.stringify(require('./jest.config.js').reporters))"], { cwd: repoRoot, env, encoding: "utf8" });
    return JSON.parse(out) as string[];
  };
  assert.ok(reporters("true").some((r) => r.endsWith("tools/ci/native-budget.mjs")));
  assert.ok(!reporters(undefined).some((r) => r.endsWith("tools/ci/native-budget.mjs")));
});
