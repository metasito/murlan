import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { IDLE_LINE, RAN_LINE, SHARD_LINE, judge, parseShardLog, shardOf, testFilesOnDisk } from "../../tools/ci/nodeShards.mjs";
import { loadWorkflow, stepIn } from "../helpers/workflow.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const testScript = (JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { scripts: { test: string } }).scripts.test;
const onDisk = testFilesOnDisk(testScript, repoRoot);

/** A shard log as the reporter prints it: the files dealt out the way `--test-shard` deals them. */
function logs(total: number, files = onDisk, skip: (f: string) => boolean = () => false) {
  return Array.from({ length: total }, (_, i) => {
    const mine = files.filter((_f, at) => at % total === i);
    return [`${SHARD_LINE}${i + 1}/${total}`, ...mine.map((f) => `${skip(f) ? IDLE_LINE : RAN_LINE}${f}`)].join("\n");
  });
}

describe("the shards' logs are judged against the files on disk", () => {
  test("the test glob is read from the script and finds the suite", () => {
    assert.ok(onDisk.length > 400, `only ${onDisk.length} test files found`);
    assert.ok(onDisk.includes("tests/server/backupDb.test.ts"));
  });

  test("a complete split passes, at any shard count", () => {
    for (const n of [1, 2, 3]) assert.deepEqual(judge(logs(n), onDisk), [], `${n} shards`);
  });

  test("a file no shard loaded is named", () => {
    const missing = "tests/tooling/nodeShards.test.ts";
    const problems = judge(logs(2, onDisk.filter((f) => f !== missing)), onDisk);
    assert.deepEqual(problems, [`test file never loaded by any shard: ${missing}`]);
  });

  test("a shard that ran the whole suite, because the flag was ignored, fails", () => {
    const whole = (i: number) => [`${SHARD_LINE}${i}/2`, ...onDisk.map((f) => `${RAN_LINE}${f}`)].join("\n");
    assert.match(judge([whole(1), whole(2)], onDisk)[0], /did not split the run/);
  });

  test("a dropped shard, a repeated shard and a mismatched total fail", () => {
    assert.match(judge(logs(2).slice(0, 1), onDisk)[0], /not 1\.\.2/);
    assert.match(judge([logs(2)[0], logs(2)[0]], onDisk)[0], /not 1\.\.2/);
    assert.match(judge([logs(2)[0], logs(3)[1]], onDisk)[0], /not 1\.\.\d/);
  });

  test("a log that is no shard's fails", () => {
    assert.match(judge(["test files run in tests/bots: 6"], onDisk)[0], /did not run as a shard/);
    assert.match(judge([], onDisk)[0], /did not run as a shard|not 1\.\./);
  });

  test("an integration file or the restore test that ran no test fails, though it loaded", () => {
    const idle = (name: string) => judge(logs(2, onDisk, (f) => f === name), onDisk);
    const integration = onDisk.find((f) => f.startsWith("tests/integration/"))!;
    assert.deepEqual(idle(integration), [`integration file loaded but ran no test (skipped?): ${integration}`]);
    assert.match(idle("tests/server/backupDb.test.ts")[0], /backup restore was not proven/);
  });

  test("a suite that moved away from the integration directory fails the floor", () => {
    const few = onDisk.filter((f) => !f.startsWith("tests/integration/"));
    assert.match(judge(logs(2, few), few)[0], /integration files found on disk/);
  });

  test("a line is parsed back as printed", () => {
    assert.deepEqual(parseShardLog(`noise\n${SHARD_LINE}2/3\n${RAN_LINE}a.test.ts\n${IDLE_LINE}b.test.ts\n`), {
      shards: [{ index: 2, total: 3 }],
      ran: ["a.test.ts"],
      idle: ["b.test.ts"],
    });
    assert.deepEqual(shardOf(["--import", "x", "--test-shard=1/2"]), { index: 1, total: 2 });
    assert.equal(shardOf(["--test-shard=0x/2"]), undefined);
  });
});

describe("npm test splits through MURLAN_TEST_SHARD", () => {
  const flags = testScript.split(" ").filter((a) => a.startsWith("--test-reporter=./"));
  const run = (shard: string | undefined, dir: string) => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    delete env.MURLAN_TEST_SHARD;
    if (shard) env.MURLAN_TEST_SHARD = shard;
    return spawnSync(process.execPath, ["scripts/nodeTest.mjs", "--test", "--test-reporter=./tests/helpers/filesRunReporter.mjs", "--test-reporter-destination=stderr", `${dir}/**/*.test.mjs`], {
      cwd: repoRoot,
      env,
      encoding: "utf8",
    });
  };

  test("the shards of a directory partition it, each file once", () => {
    assert.ok(flags.length > 0);
    const dir = mkdtempSync(path.join(tmpdir(), "shards-"));
    try {
      mkdirSync(path.join(dir, "d"));
      const names = ["a", "b", "c", "d/e", "d/f"].map((n) => `${n}.test.mjs`);
      for (const n of names) writeFileSync(path.join(dir, n), 'import test from "node:test";\ntest("x", () => {});\n');
      const seen = [1, 2].flatMap((i) => parseShardLog(run(`${i}/2`, dir).stderr).ran);
      assert.equal(new Set(seen).size, names.length, seen.join());
      assert.equal(seen.length, names.length);
      assert.ok(parseShardLog(run("1/2", dir).stderr).ran.length < names.length, "shard 1 ran everything");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a malformed shard fails the run instead of running everything", () => {
    for (const bad of ["1", "0/2", "a/b", "1/2/3"]) {
      const result = run(bad, repoRoot);
      assert.notEqual(result.status, 0, bad);
      assert.match(result.stderr, /MURLAN_TEST_SHARD must be/);
    }
  });
});

describe("ci.yml runs the halves and judges them", () => {
  const ci = loadWorkflow("ci.yml");
  const verify = ci.jobs.verify;
  const complete = ci.jobs["verify-complete"];

  test("each half takes its slice from the matrix, so the total cannot disagree with the job count", () => {
    const test = stepIn(ci, "Test").step;
    assert.equal(test.env?.MURLAN_TEST_SHARD, "${{ matrix.shard }}/${{ strategy.job-total }}");
    assert.ok(((verify.strategy?.matrix?.shard as unknown[]) ?? []).length >= 2);
  });

  test("every half's log is kept, and the judge reads them all and runs only after the halves pass", () => {
    const upload = verify.steps?.find((s) => s.uses?.startsWith("actions/upload-artifact"));
    assert.equal(upload?.with?.name, "node-test-log-${{ matrix.shard }}");
    assert.equal(upload?.with?.path, "test-output.txt");
    assert.equal(upload?.if, "${{ !cancelled() }}");
    const steps = (complete.steps ?? []).map((s) => s.run ?? "").join("\n");
    assert.match(steps, /--pattern 'node-test-log-\*'/);
    assert.match(steps, /node tools\/ci\/nodeShards\.mjs package\.json "\$RUNNER_TEMP"\/logs\/\*\/test-output\.txt/);
    assert.equal(complete.needs, "verify");
    assert.equal(complete.if, "needs.verify.result == 'success'");
  });

  test("the judge sees the whole suite and the glob it reads", () => {
    const sparse = String(complete.steps?.find((s) => s.uses?.startsWith("actions/checkout"))?.with?.["sparse-checkout"]);
    for (const dir of ["tests", "tools/ci", "scripts/lib"]) assert.ok(sparse.split("\n").includes(dir), dir);
  });
});
