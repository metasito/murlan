import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadWorkflow, step } from "../helpers/workflow.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const script = path.join(repoRoot, "tools", "ci", "report-to-tracker.sh");

function report(title: string, open: { number: number; title: string }[], fail = false): { status: number | null; calls: string[] } {
  const dir = mkdtempSync(path.join(tmpdir(), "tracker-"));
  const log = path.join(dir, "calls.log");
  writeFileSync(path.join(dir, "list.json"), JSON.stringify(open));
  const gh = path.join(dir, "gh");
  writeFileSync(gh, `#!/usr/bin/env bash\nif [ "$2" = list ]; then cat "${dir}/list.json"; elif [ -n "$STUB_FAIL" ]; then exit 1; else echo "$*" >> "${log}"; fi\n`);
  chmodSync(gh, 0o755);
  const run = spawnSync("bash", [script, title, "body.md", "soak", "bug"], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, STUB_FAIL: fail ? "1" : "" },
    encoding: "utf8",
  });
  const calls = fail ? [] : readFileSync(log, "utf8").trim().split("\n");
  return { status: run.status, calls };
}

test("a red comments on the open issue of its own title", () => {
  const { calls } = report("The soak found something", [
    { number: 4, title: "The offline-match soak found something" },
    { number: 9, title: "The soak found something" },
  ]);
  assert.deepEqual(calls, ["issue comment 9 --body-file body.md"]);
});

test("a red whose title has no open issue files one, with every label", () => {
  const { calls } = report("The offline-match soak found something", [{ number: 9, title: "The soak found something" }]);
  assert.deepEqual(calls, ["issue create --title The offline-match soak found something --label soak --label bug --body-file body.md"]);
});

test("a title with quotes, a dollar sign and backticks is matched exactly", () => {
  const title = 'It said "$HOME" and `id`';
  const { calls } = report(title, [{ number: 3, title: "It said" }, { number: 5, title }]);
  assert.deepEqual(calls, ["issue comment 5 --body-file body.md"]);
});

test("an empty tracker files a new issue", () => {
  const { calls } = report("A red", []);
  assert.deepEqual(calls, ["issue create --title A red --label soak --label bug --body-file body.md"]);
});

test("a gh failure fails the report", () => {
  assert.notEqual(report("A red", [{ number: 1, title: "A red" }], true).status, 0);
});

for (const name of ["soak.yml", "differential.yml"]) {
  test(`${name}: every job ends by reporting a red run to the tracker`, () => {
    const workflow = loadWorkflow(name);
    const jobs = Object.values(workflow.jobs);
    assert.ok(jobs.length > 0, `${name} has no jobs`);
    for (const job of jobs) {
      const report = step(job, "Report the failure to the tracker");
      assert.equal(report.if, "failure()");
      assert.match(report.run ?? "", /bash tools\/ci\/report-to-tracker\.sh "[^"]+" \S+ /);
      assert.equal(job.steps?.at(-1), report, "a step after the report can fail without being reported");
      assert.equal((job.permissions ?? workflow.permissions)?.issues, "write", "the report's job may not write issues");
    }
  });
}
