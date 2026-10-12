import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import NativeBudgetReporter, { BUDGET_S, budgetLines, CI_SLOWER, EXCEPTIONS, HARD_FACTOR, MAX_EXCEPTION_S, OUTSIDE_S, overBudget } from "../../tools/ci/native-budget.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const exceptions: Record<string, { seconds: number; why: string }> = EXCEPTIONS;
const projects = (createRequire(import.meta.url)("../../jest.config.js") as { projects: { displayName: string }[] }).projects.map((p) => p.displayName);

function run(files: Record<string, number[]>, failedSuites = 0, runtimeS: Record<string, number> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "native-budget-"));
  const listFile = path.join(dir, "over-budget.json");
  const reporter = new NativeBudgetReporter({ rootDir: repoRoot }, { out: listFile });
  for (const [key, durations] of Object.entries(files)) {
    const [project, file] = key.split(/:(.*)/s);
    reporter.onTestResult(
      { context: { config: { displayName: { name: project } } } },
      {
        testFilePath: path.join(repoRoot, file),
        testResults: durations.map((duration) => ({ duration })),
        perfStats: { runtime: runtimeS[key] !== undefined ? runtimeS[key] * 1000 : durations.reduce((a, b) => a + b, 0) },
      }
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
  const listed = existsSync(listFile) ? JSON.parse(readFileSync(listFile, "utf8")) : undefined;
  rmSync(dir, { recursive: true, force: true });
  return { error: reporter.getLastError(), out, listed };
}

const ms = (seconds: number) => seconds * 1000;

test("a file whose cases outlast the budget is named; one within it, or within its own exception, is not", () => {
  const [excepted, { seconds }] = Object.entries(exceptions)[0]!;
  assert.deepEqual(overBudget({ "ios:a.test.tsx": BUDGET_S + 1, "android:a.test.tsx": BUDGET_S, [excepted]: seconds }), [
    { file: "ios:a.test.tsx", seconds: BUDGET_S + 1, budget: BUDGET_S },
  ]);
  assert.equal(overBudget({ [excepted]: seconds + 1 }).length, 1);
});

test("a file over budget warns, summing its cases, and names the file and project; the run still passes", () => {
  const { error, out } = run({ "ios:tests/native/tableNotices.test.tsx": [ms(BUDGET_S), ms(1)], "android:tests/native/tableNotices.test.tsx": [ms(1)] });
  assert.equal(error, undefined);
  assert.match(out, /::warning::ios:tests\/native\/tableNotices\.test\.tsx spent [0-9.]+s its cases/);
  assert.doesNotMatch(out, /::(warning|error)::android:/);
});

test("the reporter fails a green run with a file over its budget times HARD_FACTOR", () => {
  const { error, out } = run({ "ios:tests/native/tableNotices.test.tsx": [ms(BUDGET_S * HARD_FACTOR), ms(1)] });
  assert.ok(error instanceof Error);
  assert.match(out, /::error::ios:tests\/native\/tableNotices\.test\.tsx spent [0-9.]+s its cases/);
  assert.equal(run({ "ios:tests/native/tableNotices.test.tsx": [ms(BUDGET_S * HARD_FACTOR)] }).error, undefined);
});

test("the reporter passes a run within budget and leaves an already red run alone", () => {
  assert.equal(run({ "ios:tests/native/tableNotices.test.tsx": [ms(1)] }).error, undefined);
  assert.equal(run({ "ios:tests/native/tableNotices.test.tsx": [ms(BUDGET_S * 9)] }, 1).error, undefined);
});

test("a run that measured no file, or no time in any, is red, red run or not", () => {
  assert.ok(run({}).error instanceof Error);
  assert.ok(run({}, 1).error instanceof Error);
  assert.ok(run({ "ios:tests/native/tableNotices.test.tsx": [0] }).error instanceof Error);
});

test("work moved out of the cases, into a beforeAll or the module body, is caught by its own ceiling", () => {
  const key = "ios:tests/native/tableNotices.test.tsx";
  const { error, out } = run({ [key]: [ms(1)] }, 0, { [key]: OUTSIDE_S * HARD_FACTOR + 2 });
  assert.ok(error instanceof Error);
  assert.match(out, /::error::ios:tests\/native\/tableNotices\.test\.tsx spent [0-9.]+s outside its cases/);
  const soft = run({ [key]: [ms(1)] }, 0, { [key]: OUTSIDE_S + 2 });
  assert.equal(soft.error, undefined);
  assert.match(soft.out, /::warning::ios:tests\/native\/tableNotices\.test\.tsx spent [0-9.]+s outside its cases/);
  assert.equal(run({ [key]: [ms(1)] }, 0, { [key]: OUTSIDE_S }).error, undefined);
});

test("a green run lists each file over budget on its cases, repo-relative, for the land gate; time outside its cases is not listed", () => {
  const slow = "tests/native/tableNotices.test.tsx";
  const cold = "tests/native/cardHitBox.test.tsx";
  const { listed } = run({ [`ios:${slow}`]: [ms(BUDGET_S + 1)], [`android:${cold}`]: [ms(1)] }, 0, { [`android:${cold}`]: OUTSIDE_S + 2 });
  assert.deepEqual(listed, [{ file: slow, seconds: BUDGET_S + 1, budget: BUDGET_S }]);
  assert.deepEqual(run({ [`ios:${slow}`]: [ms(1)] }).listed, []);
});

test("each native shard uploads the list from the runner's temp directory, and a green shard without one is red", () => {
  const prior = process.env.RUNNER_TEMP;
  process.env.RUNNER_TEMP = path.join(repoRoot, "runner-temp");
  try {
    assert.equal(new NativeBudgetReporter({ rootDir: repoRoot }).out, path.join(repoRoot, "runner-temp", "over-budget.json"));
  } finally {
    if (prior === undefined) delete process.env.RUNNER_TEMP;
    else process.env.RUNNER_TEMP = prior;
  }
  const ci = readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8");
  const native = /^ {2}native:\n([\s\S]*?)(?=^ {2}\S)/m.exec(ci.replace(/^\s*#.*\n/gm, ""))?.[1] ?? "";
  assert.match(native, /upload-artifact@\S+.*\n\s+with:\n\s+name: over-budget-native-\$\{\{ matrix\.shard \}\}\n\s+path: \$\{\{ runner\.temp \}\}\/over-budget\.json\n\s+if-no-files-found: error\n/);
});

test("the budget cannot be loosened past what was measured, nor an exception past a minute, nor the exceptions multiplied", () => {
  assert.ok(BUDGET_S <= 15, `BUDGET_S ${BUDGET_S}`);
  assert.ok(HARD_FACTOR <= 3, `HARD_FACTOR ${HARD_FACTOR}`);
  assert.ok(OUTSIDE_S <= 45, `OUTSIDE_S ${OUTSIDE_S}`);
  assert.ok(MAX_EXCEPTION_S <= 60, `MAX_EXCEPTION_S ${MAX_EXCEPTION_S}`);
  assert.ok(Object.keys(exceptions).length <= 3, `${Object.keys(exceptions).length} exceptions`);
});

test("the native job restores its jest cache only under the exact dependency set it was built from", () => {
  const ci = readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8");
  const native = /^ {2}native:\n([\s\S]*?)(?=^ {2}\S)/m.exec(ci.replace(/^\s*#.*\n/gm, ""))?.[1] ?? "";
  const restore = /- id: jest-cache\n([\s\S]*?)(?=\n\s*- )/.exec(native)?.[1] ?? "";
  assert.match(restore, /actions\/cache\/restore@/);
  assert.match(restore, /key: native-jest-\$\{\{ matrix\.shard \}\}-\$\{\{ hashFiles\('package-lock\.json', 'patches\/\*\*', 'babel\.config\.js'/);
  assert.doesNotMatch(native, /restore-keys/);
});

test("each exception names a native file and a project, says why, and grants more than the budget and no more than the cap", () => {
  for (const [key, { seconds, why }] of Object.entries(exceptions)) {
    const [project, file] = key.split(/:(.*)/s);
    assert.ok(projects.includes(project), `${key}: unknown project`);
    assert.ok(file.startsWith("tests/native/") && existsSync(path.join(repoRoot, file)), `${key}: no such file`);
    assert.ok(why.length > 20, `${key}: no reason`);
    assert.ok(seconds > BUDGET_S && seconds <= MAX_EXCEPTION_S, `${key}: ${seconds}s`);
  }
});

test("a local --json run reads each file's case time against its own budget, the reporter's way", () => {
  const [excepted, { seconds }] = Object.entries(exceptions)[0]!;
  const [project, file] = excepted.split(/:(.*)/s);
  const compiled = path.join(repoRoot, "tests/native/botMoveCost.compiled.test.tsx");
  const json = {
    testResults: [
      { name: path.join(repoRoot, file), assertionResults: [{ duration: ms(2) }, { duration: ms(1.5) }] },
      { name: path.join(repoRoot, "tests/native/tableNotices.test.tsx"), assertionResults: [{ duration: null }] },
      { name: compiled, assertionResults: [{ duration: ms(1) }] },
      { name: path.join(repoRoot, "tests/native/cardHitBox.test.tsx"), assertionResults: [{ duration: ms(6) }] },
      { name: path.join(repoRoot, "tests/native/audioEngine.test.tsx"), assertionResults: [{ duration: ms(6) }] },
    ],
  };
  const projectOf = (f: string) => (f === compiled ? "compiled" : project);
  assert.deepEqual(budgetLines(json, projectOf, repoRoot, ["tests/native/cardHitBox.test.tsx"]), [
    `  3.5s of ${seconds}s ${excepted}`,
    `  0.0s of ${BUDGET_S}s ${project}:tests/native/tableNotices.test.tsx`,
    `  1.0s of ${BUDGET_S}s compiled:tests/native/botMoveCost.compiled.test.tsx`,
    `  6.0s of ${BUDGET_S}s ${project}:tests/native/cardHitBox.test.tsx — at risk: CI runs native files up to ${CI_SLOWER}x slower`,
    `  6.0s of ${BUDGET_S}s ${project}:tests/native/audioEngine.test.tsx`,
  ]);
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
