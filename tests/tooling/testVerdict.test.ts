import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { parse } from "yaml";
import { escape, readArtifacts, run, SUITES, verdict } from "../../tools/ci/test-verdict.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const ci = path.join(root, "tools", "ci");
const work = mkdtempSync(path.join(tmpdir(), "test-verdict-"));
const results = path.join(work, "results");

/** Runs a real runner over `files` in a scratch project, its results reporter writing into `artifact`. */
function plant(artifact: string, files: Record<string, string>, command: (dir: string) => string[], extraEnv: Record<string, string> = {}) {
  const dir = path.join(work, artifact);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  const [bin, ...args] = command(dir);
  const ran = spawnSync(bin!, args, {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, NODE_TEST_CONTEXT: undefined, CI: undefined, MURLAN_TEST_RESULTS: path.join(results, artifact), ...extraEnv },
  });
  assert.ok(readArtifacts(results).some((a) => a.name === artifact && a.runs.length === 1), `${artifact} wrote no results:\n${ran.stdout}${ran.stderr}`);
}

// The scratch projects' paths, built so tests/tooling/repoLayout.test.ts does not read them as this repository's.
const under = (p: string) => `tests/${p}`;
const CLEAN = under("a/clean.test.ts");
const PLANTS = under("a/plants.test.ts");
const ONLY = under("a/only.test.ts");
const NEVER = under("a/never.test.ts");
const LONE = under("a.test.ts");
const NATIVE_PLANTS = under("native/plants.test.tsx");
const NATIVE_ONLY = under("native/only.test.tsx");
const NATIVE_CLEAN = under("native/clean.test.tsx");
const E2E_PLANTS = under("e2e/plants.spec.ts");
const E2E_CLEAN = under("e2e/clean.spec.ts");

const nodeTest = (...files: string[]) => () => [process.execPath, "--test", `--test-reporter=${path.join(ci, "results-node-reporter.mjs")}`, "--test-reporter-destination=stderr", ...files];
const resolve = createRequire(import.meta.url).resolve;
const jestConfig = `module.exports = { rootDir: __dirname, testEnvironment: ${JSON.stringify(resolve("jest-environment-node"))}, transform: {}, reporters: [${JSON.stringify(path.join(ci, "results-jest-reporter.mjs"))}] };\n`;
const jest = () => [process.execPath, resolve("jest/bin/jest"), "--config", "jest.config.js", "--ci=false"];
// The spec takes a path, the .mjs config a URL: Playwright compiles a spec to CommonJS, whose
// `require` takes no URL, and loads an .mjs config as native ESM.
const pw = resolve("@playwright/test");
const pwConfig = (retries: string, more = "") =>
  `import { defineConfig } from ${JSON.stringify(import.meta.resolve("@playwright/test"))};\nexport default defineConfig({ testDir: "tests/e2e", retries: ${retries}, ${more}reporter: [[${JSON.stringify(path.join(ci, "results-playwright-reporter.mjs"))}]] });\n`;
const playwright = (...args: string[]) => () => [process.execPath, resolve("@playwright/test/cli"), "test", "--config", "pw.config.mjs", ...args];
const spec = (body: string) => `import { test, expect } from ${JSON.stringify(pw)};\n${body}\n`;

const suites = SUITES.map((s) => ({ ...s, floor: 1 }));
const ran = (...jobs: string[]) => Object.fromEntries(SUITES.flatMap((s) => s.jobs).map((j) => [j, { result: jobs.includes(j) ? "success" : "skipped" }]));
const empty = { head: { quarantine: [] }, base: { quarantine: [] } };
const judge = (names: string[], over: Partial<Parameters<typeof verdict>[0]> = {}) => {
  const artifacts = readArtifacts(results).filter((a) => names.includes(a.name));
  const listing = [...new Set(artifacts.flatMap((a) => a.runs.flatMap((r) => r.records)).filter((r) => r.type === "test").map((r) => r.file as string))];
  return verdict({ needs: ran("verify", "native", "browser"), artifacts, listing, ledger: empty, tickets: new Map(), suites, ...over });
};
const has = (problems: string[], pattern: RegExp) => assert.ok(problems.some((p) => pattern.test(p)), `nothing matched ${pattern}:\n${problems.join("\n")}`);

before(() => {
  plant("test-results-verify-0-1", { [CLEAN]:`import { test } from "node:test";\ntest("passes", () => {});\n` }, nodeTest(CLEAN));
  plant(
    "test-results-verify-0-2",
    {
      [CLEAN]:`import { test } from "node:test";\ntest("passes", () => {});\n`,
      [PLANTS]:[
        `import { describe, test } from "node:test";`,
        `test("fails", () => { throw new Error("planted"); });`,
        `test("option skip", { skip: "planted" }, () => {});`,
        `test("context skip", (tc) => tc.skip());`,
        `test.todo("left todo");`,
        `describe.skip("skipped suite", () => { test("inside", () => {}); });`,
        `test("passes", () => {});`,
      ].join("\n"),
    },
    nodeTest(CLEAN, PLANTS),
  );
  plant(
    "test-results-verify-0-3",
    { [ONLY]:`import { test } from "node:test";\ntest.only("focused", () => {});\ntest("filtered out", () => {});\n` },
    nodeTest("--test-only", ONLY),
  );
  plant("test-results-verify-0-4", { [CLEAN]:`import { test } from "node:test";\ntest("passes", () => {});\ntest("dropped", () => {});\n` }, nodeTest("--test-name-pattern=passes", "--test-skip-pattern=dropped", CLEAN));
  plant(
    "test-results-native-1-1",
    {
      "jest.config.js": jestConfig,
      [NATIVE_PLANTS]: [
        `jest.retryTimes(2);`,
        `let n = 0;`,
        `test("flaky", () => { expect(++n).toBeGreaterThan(1); });`,
        `test.concurrent.skip("concurrent skip", async () => {});`,
        `test["skip"]("bracket skip", () => {});`,
        `test.todo("left todo");`,
      ].join("\n"),
      [NATIVE_ONLY]:`it.only("focused", () => {});\nit("filtered out", () => {});\n`,
    },
    jest,
  );
  plant("test-results-native-2-1", { "jest.config.js": jestConfig, [NATIVE_CLEAN]:`test("passes", () => {});\ntest("dropped", () => {});\n` }, () => [...jest(), "-t", "passes"]);
  plant(
    "test-results-browser-1-1",
    {
      "pw.config.mjs": pwConfig("0"),
      [E2E_PLANTS]: spec(
        [
          `const o = { retries: 2 };`,
          `test.describe("configured", () => { test.describe.configure(o); test("retried", () => {}); });`,
          `test("step skip", async () => { await test.step.skip("a step", async () => {}); });`,
          `test("body skip", () => { test.skip(true, "planted"); });`,
          `test.fixme("fixme", () => {});`,
          `test("fails", () => { expect(1).toBe(2); });`,
          `test("expected failure", () => { test.fail(); expect(1).toBe(2); });`,
        ].join("\n"),
      ),
    },
    playwright(),
  );
  plant("test-results-browser-2-1", { "pw.config.mjs": pwConfig("0"), [E2E_CLEAN]:spec(`test("passes", () => {});`) }, playwright("--retries=2", "--grep=passes"));
  plant(
    "test-results-browser-3-1",
    {
      "pw.config.mjs": pwConfig(`process.argv.includes("--list") ? 0 : Number(process.env.PLANT_RETRIES)`, "grepInvert: /dropped/, "),
      [E2E_CLEAN]:spec(`test("passes", () => {});`),
    },
    playwright(),
    { PLANT_RETRIES: "1" },
  );
});

describe("the runners' own reports, judged", () => {
  test("a clean run is green", () => assert.deepEqual(judge(["test-results-verify-0-1"], { needs: ran("verify") }), []));

  test("node: a failure, every way of skipping, and a todo are each red", () => {
    const problems = judge(["test-results-verify-0-2"], { needs: ran("verify") });
    for (const p of [/plants\.test\.ts › fails failed/, /option skip was skipped/, /context skip was skipped/, /left todo was left todo/, /skipped suite was skipped/, /not green/])
      has(problems, p);
  });

  test("node: --test-only, a name pattern and a skip pattern, whose dropped tests report nothing, are each red", () => {
    has(judge(["test-results-verify-0-3"], { needs: ran("verify") }), /ran filtered by name \(--test-only\)/);
    has(judge(["test-results-verify-0-4"], { needs: ran("verify") }), /ran filtered by name \(--test-name-pattern=passes, --test-skip-pattern=dropped\)/);
  });

  test("jest: a retried pass, it.only, test.concurrent.skip, test['skip'] and a todo are each red", () => {
    const problems = judge(["test-results-native-1-1"], { needs: ran("native") });
    for (const p of [/flaky ran with retries \(attempt 1/, /only\.test\.tsx › filtered out was skipped/, /concurrent skip was skipped/, /bracket skip was skipped/, /left todo was left todo/])
      has(problems, p);
    has(judge(["test-results-native-2-1"], { needs: ran("native") }), /ran filtered by name \(testNamePattern passes\)/);
  });

  test("playwright: retries by describe.configure, the CLI and a config ternary, a step skip, a skip, a fixme, a failure and a grep are each red", () => {
    const problems = judge(["test-results-browser-1-1", "test-results-browser-2-1", "test-results-browser-3-1"], { needs: ran("browser") });
    for (const p of [
      /configured › retried ran with retries \(attempt 0, 2 allowed/,
      /step skip › a step was skipped/,
      /body skip was skipped/,
      /fixme was skipped/,
      /plants\.spec\.ts › fails failed/,
      /browser-2-1\/.* ran filtered by name \(--grep=passes\)/,
      /browser-3-1\/.* ran filtered by name \(grep-invert \/dropped\/\)/,
    ])
      has(problems, p);
    assert.equal(problems.filter((p) => /clean\.spec\.ts › passes ran with retries/.test(p)).length, 2, problems.join("\n"));
    assert.ok(!problems.some((p) => /expected failure/.test(p)), "test.fail() is a pass: the test ran and failed as it says it must");
  });
});

describe("what the reports leave out", () => {
  const clean = () => readArtifacts(results).filter((a) => a.name === "test-results-verify-0-1");
  const listing = [CLEAN];
  const base = { needs: ran("verify"), artifacts: clean(), listing, ledger: empty, tickets: new Map(), suites };

  test("a job that ran and uploaded nothing is red", () => has(verdict({ ...base, artifacts: [] }), /verify ran \(success\) and uploaded no/));
  test("a gate that does not need a test job is red", () => has(verdict({ ...base, needs: { verify: { result: "success" } } }), /does not need native/));

  test("a results file cut short, or reported not green, is red", () => {
    const [a] = clean();
    const records = a!.runs[0]!.records;
    has(verdict({ ...base, artifacts: [{ ...a!, runs: [{ ...a!.runs[0]!, records: records.slice(0, -1) }] }] }), /ends before its runner finished/);
    has(verdict({ ...base, artifacts: [{ ...a!, runs: [{ ...a!.runs[0]!, records: [...records.slice(0, -1), { type: "end", ok: false }] }] }] }), /reported the run as not green/);
  });

  test("a listed file with no passing test, or a listing under its floor, is red", () => {
    has(verdict({ ...base, listing: [...listing, NEVER] }), /tests\/a\/never\.test\.ts is in npm test's listing and no test in it passed/);
    has(verdict({ ...base, suites: SUITES }), /npm test lists 1 test files, under its floor of 400/);
  });

  test("re-running a failed job does not wash out its failure", () => {
    const failed = readArtifacts(results).find((a) => a.name === "test-results-verify-0-2")!;
    has(verdict({ ...base, artifacts: [{ ...failed, name: "test-results-verify-0-1" }, { ...clean()[0]!, name: "test-results-verify-0-2" }] }), /plants\.test\.ts › fails failed/);
    has(verdict({ ...base, artifacts: [{ ...clean()[0]!, name: "test-results-verify-0-1" }, { ...failed, name: "test-results-verify-0-2" }] }), /re-running a failed job is a retry/);
  });

  test("a skip is heard when the same test passed elsewhere in the run", () => {
    const runOf = (...tests: { title: string; status: string }[]) => [
      { type: "run", runner: "node", filters: [] },
      ...tests.map((t) => ({ type: "test", file: "tools/loop/tests/w.test.ts", ...t })),
      { type: "end", ok: true },
    ];
    const skip = { name: "test-results-harness-0-1", runs: [{ file: "a.jsonl", records: runOf({ title: "win32 only", status: "skipped" }, { title: "anywhere", status: "passed" }) }] };
    const pass = { name: "test-results-harness-windows-0-1", runs: [{ file: "b.jsonl", records: runOf({ title: "win32 only", status: "passed" }) }] };
    const needs = { ...ran(), harness: { result: "success" }, "harness-windows": { result: "success" } };
    const loop = { ...base, needs, listing: ["tools/loop/tests/w.test.ts"] };
    assert.deepEqual(verdict({ ...loop, artifacts: [skip, pass] }), []);
    has(verdict({ ...loop, artifacts: [skip] }), /win32 only was skipped/);
  });

  test("the quarantine holds a skip only under an open ci-flake issue already on the base's ledger", () => {
    const entry = { file: PLANTS, title: "option skip", issue: 7 };
    const plants = readArtifacts(results).filter((a) => a.name === "test-results-verify-0-2");
    const on = { head: { quarantine: [entry] }, base: { quarantine: [entry] } };
    const open = new Map([[7, { open: true, labelled: true }]]);
    const q = { ...base, artifacts: plants, listing: [CLEAN, PLANTS] };
    assert.ok(!verdict({ ...q, ledger: on, tickets: open }).some((p) => /option skip was skipped/.test(p)));
    has(verdict({ ...q, ledger: { ...on, base: { quarantine: [] } }, tickets: open }), /adds .*option skip \(#7\); the quarantine only shrinks/);
    has(verdict({ ...q, ledger: on, tickets: new Map([[7, { open: false, labelled: true }]]) }), /not an open issue labelled ci-flake/);
    has(verdict({ ...q, ledger: { ...on, head: { quarantine: [{ ...entry, issue: "7" }] } }, tickets: open }), /not \{file, title, issue\}/);
  });
});

describe("the gate step", () => {
  test("head text cannot start a workflow command of its own", () => {
    assert.equal(escape("x\n::add-mask::y\r%"), "x%0A::add-mask::y%0D%25");
    const said: string[] = [];
    const artifact = { name: "test-results-verify-0-1", records: [{ type: "run", runner: "node", filters: [] }, { type: "test", file: LONE, title: "t\n::warning::forged", status: "failed" }, { type: "end", ok: false }] };
    const gh = (args: string[]) => {
      if (args[0] === "api" && args[1]!.includes("/artifacts")) return `${artifact.name}\n`;
      if (args[0] === "run") {
        const dir = path.join(args[args.indexOf("--dir") + 1]!, artifact.name);
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, "node-1.jsonl"), artifact.records.map((r) => JSON.stringify(r)).join("\n"));
        return "";
      }
      throw new Error(`unexpected gh ${args.join(" ")}`);
    };
    const git = (args: string[]) => (args[0] === "ls-tree" && args.includes("-r") ? `${LONE}\0` : "");
    const code = run({ GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "5", BASE: "HEAD^1", NEEDS: JSON.stringify(ran("verify")) }, { gh, git, log: (l: string) => void said.push(l) });
    assert.equal(code, 1);
    assert.ok(said.every((l) => !l.includes("\n")), said.join("\n"));
    assert.ok(said.some((l) => l.startsWith("::error::") && l.includes("%0A::warning::forged")), said.join("\n"));
  });

  test("a run whose test jobs were all skipped by scope has nothing to judge, and is green", () => {
    const gh = (args: string[]) => (args[0] === "api" ? "" : assert.fail(`downloaded with no artifact: ${args.join(" ")}`));
    const git = () => "";
    assert.equal(run({ GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "5", BASE: "HEAD", NEEDS: JSON.stringify(ran()) }, { gh, git, log: () => {} }), 0);
  });

  test("CI gate runs the base branch's verdict over every test job's uploaded results", () => {
    const jobs = parse(readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8")).jobs as Record<string, { steps?: { run?: string; uses?: string; with?: Record<string, unknown>; env?: Record<string, string>; if?: string }[]; env?: Record<string, string> }>;
    const gate = jobs["ci-gate"]!.steps!.map((s) => s.run ?? "").join("\n");
    assert.match(gate, /\[ "\$EVENT" = pull_request \] && base=HEAD\^1/);
    assert.match(gate, /git cat-file -e "\$base:tools\/ci\/test-verdict\.mjs" 2>\/dev\/null \|\| from=HEAD\n\s*git archive "\$from"/);
    assert.match(gate, /node "\$RUNNER_TEMP\/judge\/tools\/ci\/test-verdict\.mjs"/);
    for (const job of SUITES.flatMap((s) => s.jobs)) {
      const upload = jobs[job]!.steps!.find((s) => String(s.with?.name ?? "").startsWith("test-results-"));
      assert.ok(upload, `${job} uploads no test-results-* artifact`);
      assert.match(String(upload.with!.name), new RegExp(`^test-results-${job}-.+-\\$\\{\\{ github\\.run_attempt \\}\\}$`));
      assert.equal(upload.if, "${{ !cancelled() }}");
      assert.equal(upload.with!["if-no-files-found"], "error");
    }
  });
});
