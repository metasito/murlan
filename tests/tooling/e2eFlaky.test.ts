import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { flakyFromReport } from "../../tools/ci/e2e-flaky.mjs";

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

test("the CLI warns once per flaky test and writes them to the step summary", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "e2e-flaky-"));
  try {
    const summary = path.join(dir, "summary.md");
    writeFileSync(path.join(dir, "report.json"), JSON.stringify(report));
    const out = execFileSync(process.execPath, ["tools/ci/e2e-flaky.mjs", path.join(dir, "report.json")], {
      encoding: "utf8",
      env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
    });
    assert.deepEqual(out.trim().split("\n"), [
      "::warning::Flaky, passed on retry: a.spec.ts › racy",
      "::warning::Flaky, passed on retry: online/b.spec.ts › also racy",
    ]);
    assert.match(readFileSync(summary, "utf8"), /2 flaky[\s\S]*- a\.spec\.ts › racy\n- online\/b\.spec\.ts › also racy/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the browser report job runs it on the merged report", () => {
  const ci = readFileSync(path.join(import.meta.dirname, "..", "..", ".github", "workflows", "ci.yml"), "utf8");
  assert.match(ci, /PLAYWRIGHT_JSON_OUTPUT_NAME: merged-report\.json\s+run: npx --yes -p "\$PW" playwright merge-reports --reporter html,json \.\/all-blob-reports[\s\S]*run: node tools\/ci\/e2e-flaky\.mjs merged-report\.json/);
});

test("a report holding no spec file is refused rather than read as clean", () => {
  assert.throws(() => flakyFromReport({ suites: [] }), /no spec files/);
});
