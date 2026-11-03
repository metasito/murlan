import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { FILE_DEADLINE_MS } from "../helpers/fileDeadline.mjs";
import { HEADROOM_SHARE, overHeadroom } from "../helpers/timeoutHeadroom.mjs";
import timeoutHeadroom, { declaredTimeouts, fileLimitMs, runTimeoutMs } from "../helpers/timeoutHeadroomReporter.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const scripts = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).scripts as Record<string, string>;
const ENVIRONMENT = path.join(repoRoot, "tests", "native", "harness", "timeoutHeadroomEnvironment.mjs");
const REPORTER = "--test-reporter=./tests/helpers/timeoutHeadroomReporter.mjs";

/** Long enough that no stall makes it read under the share, short enough to stay far inside the limit. */
const SLOW_MS = 1_100;
const LIMIT_MS = 4_000;

type Event = { type: string; data: Record<string, unknown> };
const pass = (data: Record<string, unknown>, type = "test"): Event => ({
  type: "test:pass",
  data: { nesting: 1, file: "/r/a.test.ts", line: 3, column: 3, name: "x", ...data, details: { type, duration_ms: data.ms } },
});

async function report(events: Event[], options: Parameters<typeof timeoutHeadroom>[1] = {}) {
  const was = process.exitCode;
  let out = "";
  for await (const chunk of timeoutHeadroom(events, { runTimeout: 30_000, fileLimit: Infinity, read: () => "", ...options })) out += chunk;
  const failed = process.exitCode === 1;
  process.exitCode = was;
  return { out, failed, over: out.split("\n").filter((l) => l.startsWith("timeout headroom:")) };
}

describe("the share of its limit a passing test may spend", () => {
  test("is a quarter, judged past it and not at it", () => {
    assert.equal(HEADROOM_SHARE, 0.25);
    assert.equal(overHeadroom(2_500, 10_000), false);
    assert.equal(overHeadroom(2_501, 10_000), true);
    assert.equal(overHeadroom(1e9, Infinity), false);
  });
});

describe("node:test's reporter", () => {
  test("judges a test against the run's --test-timeout, and a suite only against a limit it names", async () => {
    const r = await report([pass({ ms: 7_000, name: "near" }), pass({ ms: 8_000, name: "slow" }), pass({ ms: 60_000, name: "s" }, "suite")]);
    assert.equal(r.failed, true);
    assert.equal(r.over.length, 1, r.out);
    assert.match(r.over[0], /a\.test\.ts:3 "slow": This test took 8000 ms, over 25% of its 30000 ms time limit/);
  });

  test("judges a test against its own timeout option, read off the call node names", async () => {
    const source = 'test("x", { timeout: 1_000 }, async () => {});\ndescribe("s", { timeout: 60_000 }, () => {});\n';
    const read = () => source;
    const own = await report([pass({ ms: 300, line: 1, column: 1 })], { read });
    assert.match(own.over[0] ?? "", /of its 1000 ms time limit/, own.out);
    const suite = await report([pass({ ms: 16_000, line: 2, column: 1 }, "suite")], { read });
    assert.match(suite.over[0] ?? "", /This suite took 16000 ms, over 25% of its 60000 ms/, suite.out);
    const fits = await report([pass({ ms: 200, line: 1, column: 1 })], { read });
    assert.equal(fits.failed, false, fits.out);
  });

  test("reads a timeout the file computes from its imports and top-level constants, as the file computes it", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "timeout-headroom-"));
    try {
      writeFileSync(path.join(dir, "owner.ts"), "export const BASE_MS: number = 1_500;\nexport const budget = () => ({ ms: 2 * BASE_MS });\n");
      const file = path.join(dir, "a.test.ts");
      const source = [
        'import { test } from "node:test";',
        'import { BASE_MS, budget } from "./owner.ts";',
        "const B = budget();",
        "test('x', { timeout: BASE_MS + 500 }, () => {});",
        "test('y', { timeout: B.ms * Math.max(1, 2) }, () => {});",
        "function local() { return 1; }",
        "test('z', { timeout: local() }, () => {});",
      ].join("\n");
      assert.deepEqual([...declaredTimeouts(source, file, ts)], [["4:1", 2_000], ["5:1", 6_000], ["7:1", "unreadable"]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fails a timeout it cannot read rather than judging it against another", async () => {
    const r = await report([pass({ ms: 1, line: 1, column: 1 })], { read: () => 'test("x", { timeout: LIMIT }, () => {});\n' });
    assert.equal(r.failed, true);
    assert.match(r.over[0] ?? "", /its timeout is not a number literal/);
  });

  test("judges a file against the file deadline, and only a run that imports it has one", async () => {
    const file = { nesting: 0, name: "/r/a.test.ts", file: "/r/a.test.ts", details: { passed: true, duration_ms: 40_000 } };
    const r = await report([{ type: "test:complete", data: file }], { fileLimit: 150_000 });
    assert.match(r.over[0] ?? "", /a\.test\.ts: This file took 40000 ms, over 25% of its 150000 ms/, r.out);
    assert.equal(fileLimitMs(["--import", path.join(repoRoot, "tests", "helpers", "fileDeadline.mjs")], {}), FILE_DEADLINE_MS);
    assert.equal(fileLimitMs(["--import", "./tests/helpers/elsewhere.mjs"], {}), Infinity);
  });

  test("fails a run whose tests passed with no limit to judge them by, and passes one that skipped them all", async () => {
    const unlimited = await report([pass({ ms: 1 })], { runTimeout: Infinity });
    assert.match(unlimited.over[0] ?? "", /none was judged: the run sets no --test-timeout/);
    const skipped = await report([pass({ ms: 1, skip: true })], { runTimeout: Infinity });
    assert.equal(skipped.failed, false, skipped.out);
  });

  test("reads --test-timeout as node does, the last one set", () => {
    assert.equal(runTimeoutMs(["--test", "--test-timeout=30000"]), 30_000);
    assert.equal(runTimeoutMs(["--test-timeout", "500", "--test-timeout=700"]), 700);
    assert.equal(runTimeoutMs(["--test"]), Infinity);
  });

  test("keys each call by the line and column node reports for it", () => {
    const source = [
      'test("a", { timeout: 1 }, () => {});',
      '  it.skip("b", { timeout: 2 }, () => {});',
      'test("c", async (t) => { await t.test("d", { timeout: 3 }, () => {}); });',
    ].join("\n");
    assert.deepEqual([...declaredTimeouts(source, "x.ts", ts)], [["1:1", 1], ["2:6", 2], ["3:34", 3]]);
  });

  test("runs in npm test and loop:test, and fails a slow test node really ran, by name", () => {
    for (const name of ["test", "loop:test"]) assert.ok(scripts[name].split(" ").includes(REPORTER), `${name} runs no timeout headroom reporter`);
    const dir = mkdtempSync(path.join(tmpdir(), "timeout-headroom-"));
    try {
      writeFileSync(
        path.join(dir, "planted.test.mjs"),
        'import { test } from "node:test";\n' +
          `const slow = () => new Promise((r) => setTimeout(r, ${SLOW_MS}));\n` +
          `test("slow", { timeout: ${LIMIT_MS} }, slow);\n` +
          `test("parent", async (t) => { await t.test("inner", { timeout: ${LIMIT_MS} }, slow); });\n`
      );
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      const run = spawnSync(process.execPath, ["--test", "--test-timeout=30000", REPORTER, "--test-reporter-destination=stdout", path.join(dir, "planted.test.mjs")], {
        cwd: repoRoot,
        env,
        encoding: "utf8",
      });
      assert.equal(run.status, 1, run.stdout + run.stderr);
      const over = run.stdout.split("\n").filter((l) => l.startsWith("timeout headroom:"));
      assert.equal(over.length, 2, run.stdout);
      assert.match(over[0], new RegExp(`planted\\.test\\.mjs:3 "slow": This test took \\d+ ms, over 25% of its ${LIMIT_MS} ms`));
      assert.match(over[1], new RegExp(`planted\\.test\\.mjs:4 "inner": This test took \\d+ ms, over 25% of its ${LIMIT_MS} ms`));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("jest's environment", () => {
  test("is every native project's", () => {
    const config = createRequire(import.meta.url)(path.join(repoRoot, "jest.config.js")) as { projects: { displayName: string; testEnvironment?: string }[] };
    assert.ok(config.projects.length >= 3, "jest.config.js lost its projects");
    for (const project of config.projects) assert.equal(project.testEnvironment, ENVIRONMENT.split(path.sep).join("/"), `${project.displayName} runs without it`);
  });

  test("fails a slow test, and a slow hook of either kind, that jest itself let pass", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "timeout-headroom-"));
    const wait = `() => new Promise((r) => setTimeout(r, ${SLOW_MS}))`;
    try {
      writeFileSync(
        path.join(dir, "tests.test.js"),
        `test("slow", ${wait}, ${LIMIT_MS});\ntest("fast", () => {});\n` +
          `describe("each", () => { beforeEach(${wait}, ${LIMIT_MS}); test("after a slow beforeEach", () => {}); });\n`
      );
      writeFileSync(path.join(dir, "all.test.js"), `describe("all", () => { beforeAll(${wait}, ${LIMIT_MS}); test("under it", () => {}); });\n`);
      const config = { rootDir: dir, testEnvironment: ENVIRONMENT, transform: {}, testMatch: ["**/*.test.js"], cacheDirectory: path.join(dir, ".cache") };
      const run = spawnSync(process.execPath, [createRequire(import.meta.url).resolve("jest/bin/jest"), "--config", JSON.stringify(config), "--json", "--maxWorkers=2"], {
        cwd: dir,
        encoding: "utf8",
      });
      const results = JSON.parse(run.stdout) as { testResults: { name: string; message: string; assertionResults: { title: string; status: string; failureMessages: string[] }[] }[] };
      const byTitle = Object.fromEntries(results.testResults.flatMap((f) => f.assertionResults.map((a) => [a.title, a])));
      assert.equal(byTitle.fast?.status, "passed", run.stderr);
      assert.equal(byTitle.slow?.status, "failed", run.stderr);
      assert.match(byTitle.slow.failureMessages.join("\n"), new RegExp(`This test took \\d+ ms, over 25% of its ${LIMIT_MS} ms`));
      assert.match(byTitle["after a slow beforeEach"]?.failureMessages.join("\n") ?? "", /Its beforeEach hook took \d+ ms/);
      const all = results.testResults.find((f) => f.name.endsWith("all.test.js"));
      assert.match(all?.message ?? "", /The beforeAll hook of "all" took \d+ ms/, run.stderr);
      assert.equal(run.status, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
