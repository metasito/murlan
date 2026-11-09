import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { parse } from "yaml";
import { escape, LEDGER, readArtifacts, renames, run, SUITES, verdict, wiringOf } from "../../tools/ci/test-verdict.mjs";
import { ownedBy } from "../../tools/ci/codeowners.mjs";
import { JOBS } from "../../tools/ci/scopeOf.mjs";

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
const E2E_SHARED = under("e2e/helpers/shared.ts");
const E2E_RUNS = under("e2e/runs.spec.ts");
const E2E_SKIPS = under("e2e/skips.spec.ts");
const E2E_FOCUS_A = under("e2e/focusA.spec.ts");
const E2E_FOCUS_B = under("e2e/focusB.spec.ts");
const E2E_UNFOCUSED = under("e2e/unfocused.spec.ts");
const GLOB_OK = under("b/ok.test.ts");
const GLOB_NONE = under("b/none.test.ts");
const GLOB_EXIT = under("b/exit.test.ts");
const EXITS = under("c/exits.test.ts");
const TWINS = under("c/twins.test.ts");

const nodeTest = (...files: string[]) => () => [process.execPath, "--test", `--test-reporter=${path.join(ci, "results-node-reporter.mjs")}`, "--test-reporter-destination=stderr", ...files];
const npmTest = (glob: string) => () => [process.execPath, path.join(root, "scripts", "nodeTest.mjs"), "--test", `--test-reporter=${path.join(ci, "results-node-reporter.mjs")}`, "--test-reporter-destination=stderr", glob];
const resolve = createRequire(import.meta.url).resolve;
const jestConfig = `module.exports = { rootDir: __dirname, testEnvironment: ${JSON.stringify(resolve("jest-environment-node"))}, transform: {}, reporters: [${JSON.stringify(path.join(ci, "results-jest-reporter.mjs"))}] };\n`;
const jest = () => [process.execPath, resolve("jest/bin/jest"), "--config", "jest.config.js", "--ci=false"];
// The spec takes a path, the .mjs config a URL: Playwright compiles a spec to CommonJS, whose
// `require` takes no URL, and loads an .mjs config as native ESM.
const pw = resolve("@playwright/test");
const pwConfig = (retries: string, more = "") =>
  `import { defineConfig } from ${JSON.stringify(import.meta.resolve("@playwright/test"))};\nexport default defineConfig({ testDir: "tests/e2e", retries: ${retries}, forbidOnly: true, ${more}reporter: [[${JSON.stringify(path.join(ci, "results-playwright-reporter.mjs"))}]] });\n`;
const playwright = (...args: string[]) => () => [process.execPath, resolve("@playwright/test/cli"), "test", "--config", "pw.config.mjs", ...args];
const spec = (body: string) => `import { test, expect } from ${JSON.stringify(pw)};\n${body}\n`;

const suites = SUITES.map((s) => ({ ...s, floor: 1 }));
const ran = (...jobs: string[]) => Object.fromEntries(SUITES.flatMap((s) => s.jobs).map((j) => [j, { result: jobs.includes(j) ? "success" : "skipped" }]));
const empty = { head: { quarantine: [] }, base: { quarantine: [] } };
const NOW = Date.parse("2026-11-08T12:00:00Z");
const judge = (names: string[], over: Partial<Parameters<typeof verdict>[0]> = {}) => {
  const artifacts = readArtifacts(results).filter((a) => names.includes(a.name));
  const listing = [...new Set(artifacts.flatMap((a) => a.runs.flatMap((r) => r.records)).filter((r) => r.type === "test").map((r) => r.file as string))];
  return verdict({ needs: ran("verify", "native", "browser"), artifacts, listing, ledger: empty, tickets: new Map(), changed: [], renamed: [], scope: null, now: NOW, suites, ...over });
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
  plant(
    "test-results-verify-0-5",
    {
      [EXITS]: `import { test } from "node:test";\ntest("p", () => {});\nsetTimeout(() => process.exit(0), 0);\ntest("slow", async () => { await new Promise((r) => setTimeout(r, 200)); throw new Error("planted"); });\n`,
      [TWINS]: `import { test } from "node:test";\ntest("twin", () => {});\ntest("twin", () => {});\n`,
    },
    nodeTest(EXITS, TWINS),
  );
  plant("test-results-verify-0-4",{ [CLEAN]:`import { test } from "node:test";\ntest("passes", () => {});\ntest("dropped", () => {});\n` }, nodeTest("--test-name-pattern=passes", "--test-skip-pattern=dropped", CLEAN));
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
        `test.failing("declared failing", () => { throw new Error("planted"); });`,
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
  plant(
    "test-results-browser-4-1",
    {
      "pw.config.mjs": pwConfig("0"),
      [E2E_SHARED]: `import { test } from ${JSON.stringify(pw)};\nexport const shared = (skip: boolean) => test("shared", () => { test.skip(skip, "planted"); });\n`,
      [E2E_RUNS]: `import { shared } from "./helpers/shared";\nshared(false);\n`,
      [E2E_SKIPS]: `import { shared } from "./helpers/shared";\nshared(true);\n`,
    },
    playwright(),
  );
  plant(
    "test-results-browser-5-1",
    {
      "pw.config.mjs": pwConfig("0", "forbidOnly: false, "),
      [E2E_FOCUS_A]: spec(`test.only("focused", () => {});\ntest("dropped", () => { expect(1).toBe(2); });`),
      [E2E_FOCUS_B]: spec(`test.only("focused", () => {});\ntest("dropped", () => {});`),
      [E2E_UNFOCUSED]: spec(`test("dropped", () => {});`),
    },
    playwright(),
  );
  plant(
    "test-results-verify-1-1",
    {
      [GLOB_OK]: `import { test } from "node:test";\ntest("passes", () => {});\n`,
      [GLOB_NONE]: `import { test } from "node:test";\nif (process.env.DATABASE_URL) test("needs a database", () => {});\n`,
      [GLOB_EXIT]: `import { test } from "node:test";\ntest("passes", () => {});\ntest("exits", () => { process.exit(0); });\ntest("fails", () => { throw new Error("planted"); });\n`,
    },
    npmTest(under("b/**/*.test.ts")),
    { DATABASE_URL: "" },
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

  test("node: a file that exits mid-run fails the tests it cut off, and a title reported twice is red", () => {
    const problems = judge(["test-results-verify-0-5"], { needs: ran("verify") });
    has(problems, /exits\.test\.ts › slow \(exited before it finished\) failed/);
    has(problems, /twins\.test\.ts › twin is reported twice/);
  });

  test("jest: a retried pass, it.only, test.concurrent.skip, test['skip'], a todo and test.failing are each red", () => {
    const problems = judge(["test-results-native-1-1"], { needs: ran("native") });
    for (const p of [/flaky ran with retries \(attempt 1/, /only\.test\.tsx › filtered out was skipped/, /concurrent skip was skipped/, /bracket skip was skipped/, /left todo was left todo/, /declared failing was left todo/])
      has(problems, p);
    has(judge(["test-results-native-2-1"], { needs: ran("native") }), /ran filtered by name \(testNamePattern passes\)/);
  });

  test("playwright: retries by describe.configure, the CLI and a config ternary, a step skip, a skip, a fixme, a failure, test.fail() and a grep are each red", () => {
    const problems = judge(["test-results-browser-1-1", "test-results-browser-2-1", "test-results-browser-3-1"], { needs: ran("browser") });
    for (const p of [
      /configured › retried ran with retries \(attempt 0, 2 allowed/,
      /step skip › a step was skipped/,
      /body skip was skipped/,
      /fixme was skipped/,
      /plants\.spec\.ts › fails failed/,
      /expected failure was left todo/,
      /browser-2-1\/.* ran filtered by name \(--grep=passes\)/,
      /browser-3-1\/.* ran filtered by name \(grep-invert \/dropped\/\)/,
    ])
      has(problems, p);
    assert.equal(problems.filter((p) => /clean\.spec\.ts › passes ran with retries/.test(p)).length, 2, problems.join("\n"));
  });

  test("playwright: a test a helper registers is the spec's, so one spec's skip is not heard through another's pass", () => {
    const problems = judge(["test-results-browser-4-1"], { needs: ran("browser") });
    assert.ok(!problems.some((p) => /helpers\/shared/.test(p)), problems.join("\n"));
    assert.ok(!problems.some((p) => /runs\.spec\.ts/.test(p)), problems.join("\n"));
    has(problems, /skips\.spec\.ts › shared was skipped/);
  });

  test("playwright: a test.only in every spec of a shard, with forbidOnly off, is red", () => {
    const problems = judge(["test-results-browser-5-1"], { needs: ran("browser") });
    has(problems, /browser-5-1\/.* ran filtered by name \(forbidOnly off: a test\.only runs alone/);
    assert.ok(!judge(["test-results-browser-4-1"], { needs: ran("browser") }).some((p) => /forbidOnly/.test(p)));
  });

  test("node, run as npm test runs it (nodeTest.mjs, a relative glob): a file that registers no test, or exits mid-run, passed nothing", () => {
    const problems = judge(["test-results-verify-1-1"], { needs: ran("verify"), listing: [GLOB_OK, GLOB_NONE, GLOB_EXIT] });
    has(problems, /b\/none\.test\.ts is in npm test's listing and no test in it passed/);
    has(problems, /b\/exit\.test\.ts is in npm test's listing and no test in it passed/);
    assert.ok(!problems.some((p) => /b\/ok\.test\.ts/.test(p)), problems.join("\n"));
  });
});

describe("what the reports leave out", () => {
  const clean = () => readArtifacts(results).filter((a) => a.name === "test-results-verify-0-1");
  const listing = [CLEAN];
  const base = { needs: ran("verify"), artifacts: clean(), listing, ledger: empty, tickets: new Map(), changed: [], renamed: [] as [string, string][], scope: null, now: NOW, suites };

  test("a job skipped while the base's JOBS runs it under the change's scope is red", () => {
    const docsOnly = { app: false, harness: false, scans: true };
    assert.deepEqual(verdict({ ...base, scope: docsOnly }), []);
    has(verdict({ ...base, scope: { ...docsOnly, app: true } }), /^native was skipped, but the base's scope of this change runs it$/);
    has(verdict({ ...base, needs: { ...ran(), lint: { result: "skipped" } }, artifacts: [], scope: docsOnly }), /^verify was skipped, but the base's scope of this change runs it$/);
    const all = verdict({ ...base, needs: { ...ran(), lint: { result: "skipped" }, build: { result: "skipped" } }, artifacts: [], scope: { app: true, harness: true, scans: true } });
    for (const job of Object.keys(JOBS)) has(all, new RegExp(`^${job} was skipped, but the base's scope`));
  });

  test("a suite's job that JOBS does not schedule is red", () => {
    has(verdict({ ...base, suites: [...suites, { ...suites[0]!, jobs: ["verify-extra"] }] }), /^verify-extra runs a suite, but tools\/ci\/scopeOf\.mjs's JOBS does not say when it runs$/);
  });

  test("a test file renamed out of its suite's listing is red", () => {
    assert.deepEqual(renames(`M\0a.ts\0R087\0${CLEAN}\0tests/a/clean.ts\0C100\0p\0q\0`), [[CLEAN, "tests/a/clean.ts"]]);
    has(verdict({ ...base, renamed: [[CLEAN, "tests/a/clean.ts"]] }), /clean\.test\.ts is renamed to tests\/a\/clean\.ts, out of npm test's listing/);
    assert.deepEqual(verdict({ ...base, renamed: [[NEVER, CLEAN]] }), []);
  });

  test("a job that ran and uploaded nothing is red", () => has(verdict({ ...base, artifacts: [] }), /verify ran \(success\) and uploaded no/));
  test("a gate that does not need a test job is red", () => has(verdict({ ...base, needs: { verify: { result: "success" } } }), /does not need native/));
  test("a job the gate needs that is neither a judged test job nor a known non-test job is red, and so are results no suite judges", () => {
    assert.deepEqual(verdict({ ...base, needs: { ...ran("verify"), lint: { result: "success" }, build: { result: "success" } } }), []);
    has(verdict({ ...base, needs: { ...ran("verify"), "e2e-extra": { result: "success" } } }), /CI gate needs e2e-extra, which is neither a judged test job/);
    has(verdict({ ...base, needs: { ...ran("verify"), "e2e-extra": { result: "skipped" } } }), /CI gate needs e2e-extra/);
    has(verdict({ ...base, artifacts: [...clean(), { ...clean()[0]!, name: "test-results-e2e-extra-0-1" }] }), /test-results-e2e-extra-0-1 is from e2e-extra, which no suite in SUITES judges/);
  });

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

  describe("the quarantine", () => {
    const entry = { file: PLANTS, title: "option skip", issue: 7, expires: "2026-11-15" };
    const plants = readArtifacts(results).filter((a) => a.name === "test-results-verify-0-2");
    const opened = (on: string, body = `${PLANTS} option skip`) => ({ open: true, labelled: true, created: Date.parse(on), body });
    const open = new Map([[7, opened("2026-11-05T09:00:00Z")]]);
    const q = { ...base, artifacts: plants, listing: [CLEAN, PLANTS], tickets: open };
    const held = { head: { quarantine: [entry] }, base: { quarantine: [entry] } };
    const added = { head: { quarantine: [entry] }, base: { quarantine: [] } };
    const skipRed = (problems: string[]) => problems.some((p) => /option skip was skipped/.test(p));
    const ledgerRed = (problems: string[]) => problems.filter((p) => p.startsWith("tools/ci/quarantine.json"));

    test("an entry on the base's ledger, under an open ci-flake issue, unexpired, holds its skip", () => {
      const problems = verdict({ ...q, ledger: held });
      assert.deepEqual(ledgerRed(problems), []);
      assert.ok(!skipRed(problems), problems.join("\n"));
    });

    test("an entry lands in a pull request that changes the ledger alone, and nowhere else", () => {
      const alone = verdict({ ...q, ledger: added, changed: ["tools/ci/quarantine.json"] });
      assert.deepEqual(ledgerRed(alone), []);
      for (const changed of [["tools/ci/quarantine.json", PLANTS], [PLANTS], []])
        has(verdict({ ...q, ledger: added, changed }), /adds .*option skip \(#7\) beside other changes; a quarantine lands in a pull request of its own/);
      assert.ok(skipRed(verdict({ ...q, ledger: added, changed: [PLANTS] })), "an addition that is refused holds nothing");
    });

    test("an entry expires at most 14 days after its issue was opened, even one the base holds, and is red once it has", () => {
      const tickets = new Map([[7, opened("2026-11-08T23:00:00Z")]]);
      const ledger = (expires: string) => ({ head: { quarantine: [{ ...entry, expires }] }, base: { quarantine: [] } });
      assert.deepEqual(ledgerRed(verdict({ ...q, tickets, ledger: ledger("2026-11-22"), changed: [LEDGER] })), []);
      has(verdict({ ...q, tickets, ledger: ledger("2026-11-23"), changed: [LEDGER] }), /until 2026-11-23, more than 14 days after #7 was opened/);
      const renewed = { ...entry, expires: "2026-11-30" };
      const late = verdict({ ...q, ledger: { head: { quarantine: [renewed] }, base: { quarantine: [renewed] } } });
      has(late, /until 2026-11-30, more than 14 days after #7 was opened/);
      assert.ok(skipRed(late), "an entry past its issue's fourteenth day holds nothing");
      const expired = { head: { quarantine: [{ ...entry, expires: "2026-11-07" }] }, base: { quarantine: [{ ...entry, expires: "2026-11-07" }] } };
      const problems = verdict({ ...q, ledger: expired });
      has(problems, /quarantine of .*option skip expired on 2026-11-07/);
      assert.ok(skipRed(problems), "an expired entry holds nothing");
      has(verdict({ ...q, ledger: { head: { quarantine: [entry] }, base: { quarantine: [{ ...entry, expires: "2026-11-09" }] } }, changed: [PLANTS] }), /beside other changes/);
    });

    test("an issue quarantines one test, and a test the base holds cannot move to a new issue", () => {
      const twin = { ...entry, title: "context skip" };
      has(verdict({ ...q, ledger: { head: { quarantine: [entry, twin] }, base: { quarantine: [entry, twin] } } }), /under #7, which already holds .*option skip/);
      const moved = verdict({ ...q, tickets: new Map([...open, [8, opened("2026-11-08T09:00:00Z")]]), ledger: { head: { quarantine: [{ ...entry, issue: 8 }] }, base: { quarantine: [entry] } }, changed: [LEDGER] });
      has(moved, /moves .*option skip from #7 to #8; a quarantine is not renewed under a new issue/);
      assert.ok(skipRed(moved));
    });

    test("an entry needs an open issue labelled ci-flake", () => {
      const created = Date.parse("2026-11-05T09:00:00Z");
      const body = `${PLANTS} option skip`;
      for (const t of [{ open: false, labelled: true, created, body }, { open: true, labelled: false, created, body }, undefined]) {
        const problems = verdict({ ...q, ledger: held, tickets: new Map(t ? [[7, t]] : []) });
        has(problems, /under #7, which is not an open issue labelled ci-flake/);
        assert.ok(skipRed(problems));
      }
    });

    test("an issue must name the test's file and title, so a label on any open issue quarantines nothing", () => {
      const created = Date.parse("2026-11-05T09:00:00Z");
      for (const body of ["", `${PLANTS} some other test`, "option skip"]) {
        const problems = verdict({ ...q, ledger: held, tickets: new Map([[7, { open: true, labelled: true, created, body }]]) });
        has(problems, /under #7, whose body does not name that test's file and title/);
        assert.ok(skipRed(problems));
      }
    });

    test("the ledger holds at most 5 entries, and none without its shape", () => {
      const six = Array.from({ length: 6 }, (_, i) => ({ ...entry, title: i ? `other ${i}` : entry.title }));
      const problems = verdict({ ...q, ledger: { head: { quarantine: six }, base: { quarantine: six } } });
      has(problems, /holds 6 entries, over its cap of 5/);
      assert.ok(skipRed(problems), "a ledger over its cap holds nothing");
      const { expires: _, ...noExpiry } = entry;
      for (const bad of [noExpiry, { ...entry, issue: "7" }, { ...entry, expires: "soon" }])
        has(verdict({ ...q, ledger: { head: { quarantine: [bad] }, base: { quarantine: [] } }, changed: ["tools/ci/quarantine.json"] }), /not \{file, title, issue, expires/);
      has(verdict({ ...q, ledger: { head: {}, base: { quarantine: [] } } }), /has no "quarantine" list/);
    });
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

  test("a push to main whose test jobs were all skipped by scope has nothing to judge, and is green", () => {
    const gh = (args: string[]) => (args[0] === "api" ? "" : assert.fail(`downloaded with no artifact: ${args.join(" ")}`));
    const git = () => "";
    const env = { GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "5", BASE: "HEAD", NEEDS: JSON.stringify(ran()) };
    assert.equal(run({ ...env, EVENT: "push", REF: "refs/heads/main" }, { gh, git, log: () => {} }), 0);
    for (const [EVENT, REF] of [["workflow_dispatch", "refs/heads/main"], ["schedule", "refs/heads/main"], ["push", "refs/heads/other"], ["pull_request", "refs/pull/1/merge"]]) {
      const said: string[] = [];
      assert.equal(run({ ...env, EVENT, REF }, { gh, git, log: (l: string) => void said.push(l) }), 1);
      has(said, /BASE is HEAD on a .*; only a push to main is its own base/);
    }
  });

  test("a dispatch is judged against main: a 300-day entry beside code is red, and so is every suite its scope runs and skipped", () => {
    const said: string[] = [];
    const long = { file: PLANTS, title: "option skip", issue: 7, expires: "2027-09-04" };
    const gh = (args: string[]) =>
      args[1]!.includes("/issues/") ? JSON.stringify({ state: "open", created_at: "2026-11-08T00:00:00Z", body: `${PLANTS} option skip`, pr: false, labels: ["ci-flake"] }) : args[0] === "api" ? "" : assert.fail(args.join(" "));
    const git = (args: string[]) => {
      if (args[0] === "ls-tree" && !args.includes("-r")) return args[2] === "HEAD" ? LEDGER : "";
      if (args[0] === "show") return JSON.stringify({ quarantine: [long] });
      if (args[0] === "diff") return args.includes("--name-status") ? "" : `lib/game/gameEngine.ts\0${LEDGER}\0`;
      return "";
    };
    const env = { GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "5", BASE: "0123abc", EVENT: "workflow_dispatch", REF: "refs/heads/feature", NEEDS: JSON.stringify(ran()) };
    assert.equal(run(env, { gh, git, log: (l: string) => void said.push(l) }), 1);
    has(said, /adds .*option skip \(#7\) beside other changes/);
    has(said, /until 2027-09-04, more than 14 days after #7 was opened/);
    has(said, /native was skipped, but the base's scope of this change runs/);
  });

  describe("the runners' wiring, which the head runs and the base cannot vouch for", () => {
    const REPORTER = "tools/ci/results-node-reporter.mjs";
    const pkg = (test: string, more = {}) => JSON.stringify({ scripts: { test, lint: "eslint ." }, ...more });
    const BUDGET = "tools/ci/e2e-budget.mjs";
    const CONFIG = "tests/e2e/playwright.config.ts";
    const ENVIRONMENT = "tests/native/harness/timeoutHeadroomEnvironment.mjs";
    const SETUP = "tests/native/setup.ts";
    const configNaming = (...reporters: string[]) =>
      `import { resolve } from "node:path";\nexport default {\n  globalSetup: resolve(__dirname, "../../tools/ci/preflightMemory.mjs"),\n  reporter: process.env.CI\n    ? [["list"], ${reporters.map((r) => `[resolve(__dirname, "../../${r}")]`).join(", ")}]\n    : [["list"]],\n  retries: 0,\n};\n`;
    const baseTree = {
      "tools/ci/test-verdict.mjs": "",
      ".github/CODEOWNERS": "/tools/ci/ @o\n/tools/ci/test-verdict.mjs\n/tools/ci/results-*.mjs @o\npackage.json @o\n/tests/e2e/playwright*.config.ts @o\njest.config.js @o\n/tests/native/ @o\n",
      [REPORTER]: "report",
      [BUDGET]: "export default class { onTestEnd() {} }\n",
      "tools/ci/preflightMemory.mjs": "export default () => {};\n",
      [CONFIG]: configNaming(BUDGET, "tools/ci/results-playwright-reporter.mjs"),
      "package.json": pkg("node --test --test-reporter=./tools/ci/results-node-reporter.mjs"),
      "app.ts": "1",
      "jest.config.js": `const rootDir = __dirname;\nmodule.exports = { projects: [{ setupFilesAfterEnv: [\`\${rootDir}/${SETUP}\`], testEnvironment: \`\${rootDir}/${ENVIRONMENT}\` }] };\n`,
      [ENVIRONMENT]: "export default class { async handleTestEvent() {} }\n",
      [SETUP]: 'require("./mocks/http");\n',
      "tests/native/mocks/http.ts": "export {};\n",
    };
    const FORGED = "export default class { onTestEnd(_test, result) { result.status = \"passed\"; } }\n";
    /** Commits the base, then the head over it in a scratch repository, and runs the verdict with real git. */
    function judgeHead(head: Record<string, string>, base: Record<string, string | null> = {}) {
      const dir = mkdtempSync(path.join(work, "wiring-"));
      const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
      const git = (args: string[]) => {
        const r = spawnSync("git", args, { cwd: dir, env, encoding: "utf8" });
        assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
        return r.stdout;
      };
      git(["init", "-q"]);
      for (const tree of [{ ...baseTree, ...base }, head]) {
        for (const [file, text] of Object.entries(tree)) {
          if (text === null) continue;
          mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
          writeFileSync(path.join(dir, file), text);
          git(["add", file]);
        }
        git(["commit", "-q", "--allow-empty", "-m", "c"]);
      }
      const said: string[] = [];
      const gh = (args: string[]) => (args[0] === "api" ? "" : assert.fail(args.join(" ")));
      run({ GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "5", BASE: "HEAD^1", EVENT: "pull_request", REF: "refs/pull/1/merge", NEEDS: JSON.stringify(ran()) }, { gh, git, log: (l: string) => void said.push(l) });
      return said;
    }
    const annotated = (said: string[], files: string) => has(said.filter((l) => l.startsWith("::error title=Runners' wiring changed::")), new RegExp(`wiring changed \\(${files}\\)`));
    const summarised = (said: string[], files: string) => has(said.filter((l) => !l.startsWith("::")), new RegExp(`records: .*; the runners' wiring changed \\(${files}\\)`));
    const redBeside = (said: string[]) => said.some((l) => /::error::the runners' wiring changes .* beside/.test(l));

    test("a reporter edited alone, beside owner-reviewed files only, is annotated and summarised by name, and not red for it", () => {
      const said = judgeHead({ [REPORTER]: "report passed" });
      annotated(said, REPORTER);
      summarised(said, REPORTER);
      assert.ok(!redBeside(said), said.join("\n"));
    });

    test("a reporter edited beside a file its owner does not review is red, naming that file", () => {
      const said = judgeHead({ [REPORTER]: "report passed", "app.ts": "2" });
      annotated(said, REPORTER);
      has(said, /::error::the runners' wiring changes \(tools\/ci\/results-node-reporter\.mjs\) beside app\.ts, which \.github\/CODEOWNERS at the base gives no reviewer/);
    });

    test("package.json counts by its test scripts: a test script changed is wiring, a dependency is not", () => {
      annotated(judgeHead({ "package.json": pkg("node --test --test-reporter=./forged.mjs"), "app.ts": "2" }), "package\\.json \\(test\\)");
      const deps = judgeHead({ "package.json": pkg("node --test --test-reporter=./tools/ci/results-node-reporter.mjs", { dependencies: { a: "1" } }), "app.ts": "2" });
      assert.ok(!deps.some((l) => /wiring/.test(l)), deps.join("\n"));
    });

    test("a reporter a config names forges a pass, so it is wiring: annotated alone, red beside a file no owner reviews", () => {
      const alone = judgeHead({ [BUDGET]: FORGED });
      annotated(alone, BUDGET);
      assert.ok(!redBeside(alone), alone.join("\n"));
      const beside = judgeHead({ [BUDGET]: FORGED, "app.ts": "2" });
      has(beside, /::error::the runners' wiring changes \(tools\/ci\/e2e-budget\.mjs\) beside app\.ts/);
      annotated(judgeHead({ "tools/ci/preflightMemory.mjs": FORGED }), "tools/ci/preflightMemory\\.mjs");
    });

    test("the native run's environment and setup run in every test, so they are wiring: a failure recorded as passed is red beside a file no owner reviews", () => {
      const forged = 'export default class { async handleTestEvent(event) { if (event.name === "test_done") event.test.errors.length = 0; } }\n';
      annotated(judgeHead({ [ENVIRONMENT]: forged }), ENVIRONMENT.replace(/\./g, "\\."));
      has(judgeHead({ [ENVIRONMENT]: forged, "app.ts": "2" }), /::error::the runners' wiring changes \(tests\/native\/harness\/timeoutHeadroomEnvironment\.mjs\) beside app\.ts/);
      has(judgeHead({ [SETUP]: 'afterEach(() => { expect.hasAssertions = () => {}; });\n', "app.ts": "2" }), /::error::the runners' wiring changes \(tests\/native\/setup\.ts\) beside app\.ts/);
      has(judgeHead({ "tests/native/mocks/http.ts": "globalThis.forged = true;\n", "app.ts": "2" }), /::error::the runners' wiring changes \(tests\/native\/mocks\/http\.ts\) beside app\.ts/);
    });

    test("a reporter the head's config newly names is wiring, and the base's ownerless line un-owns its judge", () => {
      const NEW = "tools/ci/forged.mjs";
      const said = judgeHead({ [NEW]: FORGED, [CONFIG]: configNaming(NEW, "tools/ci/results-playwright-reporter.mjs"), "tools/ci/test-verdict.mjs": "x" });
      annotated(said, `${CONFIG.replace(/\./g, "\\.")}, ${NEW.replace(/\./g, "\\.")}`);
      has(said, /beside tools\/ci\/test-verdict\.mjs, which/);
    });

    test("a head judging its own run, on a base with no judge, is annotated, and its own rule is not what holds it", () => {
      const said = judgeHead({ [REPORTER]: "report passed", "app.ts": "2" }, { "tools/ci/test-verdict.mjs": null });
      has(said.filter((l) => l.startsWith("::error title=")), /and the head judges itself/);
      assert.ok(!redBeside(said), said.join("\n"));
    });
  });

  test("CODEOWNERS reads as GitHub does: the last matching line decides, and one naming no owner un-owns", () => {
    const owned = ownedBy("/tools/ @o\n/tools/ci/x.mjs\n*.md # docs\n/tools/ci/y.mjs # dropped\n/tools/ci/z.mjs @o # kept\n");
    assert.deepEqual(["tools/a.mjs", "tools/ci/x.mjs", "README.md", "tools/ci/y.mjs", "tools/ci/z.mjs"].map(owned), [true, false, false, false, true]);
    assert.equal(ownedBy("/tools/ci/x.mjs\n/tools/ @o\n")("tools/ci/x.mjs"), true);
  });

  test("the wiring is derived from the configs and the judged suites' scripts, through their imports", () => {
    const tree: Record<string, string> = {
      "jest.config.js": "const rootDir = __dirname;\nmodule.exports = { reporters: ['default', `${rootDir}/tools/ci/native-budget.mjs`], globalTeardown: `${rootDir}/t/down.mjs`, setupFilesAfterEnv: [`${rootDir}/t/setup.ts`], testEnvironment: '<rootDir>/t/env.mjs', setupFiles: ['<rootDir>/t/noExtension', '<rootDir>t/bare.ts'], moduleNameMapper: { x: '<rootDir>/README' } };\n",
      "t/env.mjs": "",
      "t/noExtension.ts": "",
      "t/bare.ts": "",
      README: "",
      "tools/ci/native-budget.mjs": 'import { HARD } from "./e2e-budget.mjs";\n',
      "tools/ci/e2e-budget.mjs": "",
      "t/down.mjs": "",
      "t/setup.ts": "",
      "scripts/nodeTest.mjs": 'import { x } from "./lib/proc.mjs";\n',
      "scripts/lib/proc.mjs": "",
      "tools/ci/results-node-reporter.mjs": "",
      "unrelated.mjs": "",
    };
    const scripts = { test: "node scripts/nodeTest.mjs --test-reporter=./tools/ci/results-node-reporter.mjs \"tests/**/*.test.ts\"", lint: "node unrelated.mjs" };
    assert.deepEqual(wiringOf(Object.keys(tree), (f) => tree[f] ?? null, scripts), [
      "jest.config.js",
      "scripts/lib/proc.mjs",
      "scripts/nodeTest.mjs",
      "t/bare.ts",
      "t/down.mjs",
      "t/env.mjs",
      "t/noExtension.ts",
      "t/setup.ts",
      "tools/ci/e2e-budget.mjs",
      "tools/ci/native-budget.mjs",
      "tools/ci/results-node-reporter.mjs",
    ]);
  });

  test("CI gate runs the base branch's verdict over every test job's uploaded results", () => {
    const jobs = parse(readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8")).jobs as Record<string, { steps?: { run?: string; uses?: string; with?: Record<string, unknown>; env?: Record<string, string>; if?: string }[]; env?: Record<string, string> }>;
    const gate = jobs["ci-gate"]!.steps!.map((s) => s.run ?? "").join("\n");
    assert.match(gate, /"pull_request "\*\) base=HEAD\^1 ;;/);
    assert.match(gate, /"push refs\/heads\/main"\) base=HEAD ;;/);
    assert.match(gate, /\*\) git fetch --no-tags --depth=1 origin main && base=\$\(git rev-parse FETCH_HEAD\) ;;/);
    assert.match(gate, /node "\$RUNNER_TEMP\/judge\/tools\/ci\/test-verdict\.mjs"/);
    const step = jobs["ci-gate"]!.steps!.find((s) => s.run?.includes("test-verdict.mjs"))!;
    assert.deepEqual([step.env!.EVENT, step.env!.REF], ["${{ github.event_name }}", "${{ github.ref }}"]);
    for (const job of SUITES.flatMap((s) => s.jobs)) {
      const upload = jobs[job]!.steps!.find((s) => String(s.with?.name ?? "").startsWith("test-results-"));
      assert.ok(upload, `${job} uploads no test-results-* artifact`);
      assert.match(String(upload.with!.name), new RegExp(`^test-results-${job}-.+-\\$\\{\\{ github\\.run_attempt \\}\\}$`));
      assert.equal(upload.if, "${{ !cancelled() }}");
      assert.equal(upload.with!["if-no-files-found"], "error");
    }
  });
});

describe("which commit's judge the gate step runs, the step itself run over scratch histories", () => {
  const jobs = parse(readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8")).jobs as Record<string, { steps: { run?: string }[] }>;
  const script = jobs["ci-gate"]!.steps.find((s) => s.run?.includes("test-verdict.mjs"))!.run!;
  const WRITER = "tools/ci/results-writer.mjs";
  const JUDGE = "tools/ci/test-verdict.mjs";
  const judgeBy = (who: string) => `console.log("judged by the ${who}");\n`;
  const always = { "scripts/lib/entry.mjs": "", "tests/e2e/tiers.mjs": "", "app.ts": "1" };

  /** Commits each tree over the last (null deletes a file), the last as HEAD, and runs the step as GitHub's bash does. */
  function gate(...commits: Record<string, string | null>[]) {
    const dir = mkdtempSync(path.join(work, "gate-"));
    const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
    const git = (...args: string[]) => assert.equal(spawnSync("git", args, { cwd: dir, env, encoding: "utf8" }).status, 0, `git ${args.join(" ")}`);
    git("init", "-q");
    for (const tree of [always, ...commits]) {
      for (const [file, text] of Object.entries(tree)) {
        if (text === null) git("rm", "-q", file);
        else {
          mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
          writeFileSync(path.join(dir, file), text);
          git("add", file);
        }
      }
      git("commit", "-q", "--allow-empty", "-m", "c");
    }
    const ran = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
      cwd: dir,
      env: { ...env, EVENT: "pull_request", REF: "refs/pull/1/merge", RUNNER_TEMP: mkdtempSync(path.join(work, "runner-")) },
      encoding: "utf8",
    });
    return { code: ran.status, out: `${ran.stdout}${ran.stderr}` };
  }
  const judged = (r: { code: number | null; out: string }, who: string) => (assert.equal(r.code, 0, r.out), assert.match(r.out, new RegExp(`judged by the ${who}`)));
  const red = (r: { code: number | null; out: string }) => (assert.equal(r.code, 1, r.out), assert.match(r.out, /::error::the base has no tools\/ci\/test-verdict\.mjs, so nothing may judge this run/), assert.doesNotMatch(r.out, /judged by/));

  test("a base with a judge judges, whatever the head does to it", () => {
    judged(gate({ [WRITER]: "", [JUDGE]: judgeBy("base") }, { [JUDGE]: judgeBy("head") }), "base");
    judged(gate({ [WRITER]: "", [JUDGE]: judgeBy("base") }, { [WRITER]: null, [JUDGE]: null }), "base");
  });

  test("a head that adds both the writer and the judge to a base with neither is red: a head never judges itself", () => {
    red(gate({ [WRITER]: "", [JUDGE]: judgeBy("head") }));
  });

  test("a base that deleted its judge is red", () => {
    red(gate({ [WRITER]: "", [JUDGE]: judgeBy("base") }, { [WRITER]: null, [JUDGE]: null }, { "app.ts": "2" }));
    red(gate({ [WRITER]: "", [JUDGE]: judgeBy("base") }, { [JUDGE]: null }, { "app.ts": "2" }));
  });

  test("a head that adds both back after the base deleted them is red", () => {
    red(gate({ [WRITER]: "", [JUDGE]: judgeBy("base") }, { [WRITER]: null, [JUDGE]: null }, { [WRITER]: "", [JUDGE]: judgeBy("head") }));
  });

  test("a base that renamed its judge is red", () => {
    red(gate({ [WRITER]: "", [JUDGE]: judgeBy("base") }, { [WRITER]: null, [JUDGE]: null, "tools/ci/writer.mjs": "", "tools/ci/verdict.mjs": judgeBy("base") }, { "app.ts": "2" }));
  });

  test("a head that adds only one of the two is red", () => {
    red(gate({ [JUDGE]: judgeBy("head") }));
    red(gate({ [WRITER]: "" }, { "app.ts": "2", [JUDGE]: judgeBy("head") }));
  });
});
