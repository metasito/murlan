import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { flakyFromReport, KNOWN_FLAKY, verdict } from "../../tools/ci/e2e-flaky.mjs";

const spec = (title: string, status: string) => ({ title, tests: [{ status }] });
const report = {
  suites: [
    {
      file: "a.spec.ts",
      specs: [spec("steady", "expected")],
      suites: [{ file: "a.spec.ts", specs: [spec("racy", "flaky"), spec("broken", "unexpected")] }],
    },
    { file: "online/b.spec.ts", specs: [spec("also racy", "flaky")] },
  ],
};

test("names every test that passed only on a retry, and nothing else", () => {
  assert.deepEqual(flakyFromReport(report), ["a.spec.ts › racy", "online/b.spec.ts › also racy"]);
});

test("the CLI fails the run on every flaky test, by name, and writes them to the step summary", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "e2e-flaky-"));
  try {
    const summary = path.join(dir, "summary.md");
    writeFileSync(path.join(dir, "report.json"), JSON.stringify(report));
    const run = spawnSync(process.execPath, ["tools/ci/e2e-flaky.mjs", path.join(dir, "report.json")], {
      encoding: "utf8",
      env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
    });
    assert.equal(run.status, 1, run.stderr);
    assert.deepEqual(
      run.stdout.trim().split("\n").map((l) => l.split(" — ")[0]),
      ["::error::Flaky, passed on retry: a.spec.ts › racy", "::error::Flaky, passed on retry: online/b.spec.ts › also racy"]
    );
    assert.match(readFileSync(summary, "utf8"), /2 flaky[\s\S]*- a\.spec\.ts › racy\n- online\/b\.spec\.ts › also racy/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a known race is excused only while its issue is open", async () => {
  const known: [string, number][] = [["a.spec.ts › racy", 7]];
  const open = async (n: number) => n === 7;
  const closed = async () => false;
  assert.deepEqual(await verdict(["a.spec.ts › racy", "b.spec.ts › new"], known, open), {
    excused: [["a.spec.ts › racy", 7]],
    failed: ["b.spec.ts › new"],
  });
  assert.deepEqual(await verdict(["a.spec.ts › racy"], known, closed), { excused: [], failed: ["a.spec.ts › racy"] });
});

test("every known race names a spec that exists and an issue", () => {
  for (const [name, issue] of KNOWN_FLAKY) {
    const file = name.split(" › ")[0]!;
    assert.ok(existsSync(path.join(import.meta.dirname, "..", "e2e", file)), `${name}: no such spec`);
    assert.ok(Number.isInteger(issue) && issue > 0, `${name}: ${issue} is not an issue number`);
  }
});

test("the browser report job runs it on the merged report", () => {
  const ci = readFileSync(path.join(import.meta.dirname, "..", "..", ".github", "workflows", "ci.yml"), "utf8");
  assert.match(ci, /PLAYWRIGHT_JSON_OUTPUT_NAME: merged-report\.json\s+run: npx --yes -p "\$PW" playwright merge-reports --reporter html,json \.\/all-blob-reports[\s\S]*run: node tools\/ci\/e2e-flaky\.mjs merged-report\.json/);
  const step = /- name: Name the tests that passed only on a retry\n[\s\S]*?(?=\n\n|\n {6}- )/.exec(ci)?.[0] ?? "";
  assert.match(step, /\n {8}env:\n {10}GITHUB_TOKEN: \$\{\{ github\.token \}\}\n/, "issueIsOpen reads GITHUB_TOKEN");
  const job = /\n {2}browser-report:\n[\s\S]*?(?=\n {2}[\w-]+:\n)/.exec(ci)?.[0] ?? "";
  assert.match(job, /\n {4}permissions:\n(?: {6}.*\n)*? {6}issues: read\n/, "a job-level permissions block zeroes every scope it omits");
});

test("a report holding no spec file is refused rather than read as clean", () => {
  assert.throws(() => flakyFromReport({ suites: [] }), /no spec files/);
});
