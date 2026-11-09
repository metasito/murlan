import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unloaded } from "../helpers/filesRunReporter.mjs";
import { sourcesUnder } from "../helpers/sourceScan.ts";
import { loadWorkflow } from "../helpers/workflow.ts";

/**
 * A skip, a filter and a missing file are judged by CI gate over the runners' own results
 * (tests/tooling/testVerdict.test.ts). What stays here is what those results cannot say: a file
 * no runner loaded, and a win32-only test sent to the one runner that can run it.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const readRepoFile = (...parts: string[]) => readFileSync(path.join(repoRoot, ...parts), "utf8");

const CI = loadWorkflow("ci.yml");

test("a test file the run never loaded fails it by name", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "files-run-"));
  try {
    mkdirSync(path.join(dir, "tests", "engine"), { recursive: true });
    mkdirSync(path.join(dir, "tools", "loop", "tests"), { recursive: true });
    for (const f of [
      ["tests", "a.test.ts"],
      ["tests", "engine", "b.test.ts"],
      ["tests", "engine", "c.test.tsx"],
      ["tools", "loop", "tests", "d.test.ts"],
    ]) {
      writeFileSync(path.join(dir, ...f), "");
    }
    assert.deepEqual(unloaded([path.join(dir, "tests", "a.test.ts")], dir), [["tests", "engine", "b.test.ts"].join("/")]);
    assert.deepEqual(unloaded([path.join(dir, "tools", "loop", "tests", "d.test.ts")], dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("loop:test fails when a test file never loaded", () => {
  const scripts = JSON.parse(readRepoFile("package.json")).scripts;
  const reporters = (script: string) => script.split(" ").filter((a) => a.startsWith("--test-reporter"));

  test("it carries npm test's reporters", () => {
    assert.deepEqual(reporters(scripts["loop:test"]), reporters(scripts.test));
  });

  test("a glob matching nothing fails it", () => {
    const args = (scripts["loop:test"] as string).split(" ").slice(1, -1);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    delete env.MURLAN_TEST_RESULTS;
    const run = spawnSync(process.execPath, [...args, "tools/loop/tests/**/no-such-*.test.ts"], {
      cwd: repoRoot,
      env,
      encoding: "utf8",
    });
    assert.notEqual(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stderr, /no test file loaded at all/);
  });
});

describe("the loop tests that skip off win32 run on Windows", () => {
  const windows = CI.jobs["harness-windows"];
  const job = (windows.steps ?? []).map((s) => s.run ?? "").join("\n");
  const dir = path.join(repoRoot, "tools", "loop", "tests");
  const loopTests = sourcesUnder(repoRoot, ["tools/loop/tests"], /^[^/\\]+\.test\.ts$/).map(([rel]) => path.posix.basename(rel));
  const lines = (f: string) => readFileSync(path.join(dir, f), "utf8").split("\n");

  test("the Windows leg selects every one of them", () => {
    assert.equal(windows["runs-on"], "windows-latest");
    const pattern = /grep -lE '([^']+)' tools\/loop\/tests\/\*\.test\.ts/.exec(job)?.[1];
    assert.ok(pattern, "the Windows leg no longer selects its files with grep");
    const selected = loopTests.filter((f) => lines(f).some((l) => new RegExp(pattern).test(l)));
    const code = (f: string) => lines(f).filter((l) => !/^\s*(\/\/|\/?\*)/.test(l));
    const gated = loopTests.filter((f) => code(f).some((l) => /\bskip\b.*(\bwin32\b|\bonWindows\b|platform)/.test(l)));
    assert.ok(gated.length > 0, "no loop test file skips off win32: the scan has stopped matching");
    assert.deepEqual(selected, gated);
    assert.match(job, /\[ -n "\$files" \] \|\| \{[^}]*exit 1; \}/);
  });

  test("it runs them with loop:test's own flags, its results reporter among them", () => {
    const flags = (JSON.parse(readRepoFile("package.json")).scripts["loop:test"] as string)
      .split(" ")
      .filter((a) => /^--test-(timeout|force-exit)/.test(a) || a === "--test-reporter=./tools/ci/results-node-reporter.mjs");
    for (const flag of flags) assert.ok(job.includes(` ${flag} `), `the Windows leg drops ${flag}`);
  });
});
