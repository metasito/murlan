import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkflow, workflowFiles } from "../helpers/workflow.ts";

const rulesPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "agents", "RULES.md");

/** Every job in every workflow, with its own `timeout-minutes`, if it declares one. */
function jobs(): { job: string; minutes: unknown }[] {
  return workflowFiles().flatMap((file) =>
    Object.entries(loadWorkflow(file).jobs).map(([id, job]) => ({ job: `${file}:${id}`, minutes: job["timeout-minutes"] })),
  );
}

test("every CI job caps its own run time", () => {
  const all = jobs();
  assert.ok(all.length >= 15, `found only ${all.length} jobs; the parser no longer sees the workflows`);
  assert.deepEqual(all.filter((j) => j.minutes === undefined).map((j) => j.job), [], "a hung job without a cap runs for GitHub's 6-hour default");
});

test("both device compiles are capped at the budget rule 46 gives them", () => {
  const rule = /^46\. [^\n]*`Android compiles` and `iOS compiles`[^\n]*`timeout-minutes: (\d+)`/m.exec(readFileSync(rulesPath, "utf8"));
  assert.ok(rule, "rule 46 no longer names the device compiles' budget as `timeout-minutes: N`");
  const caps = jobs().filter((j) => j.job === "ci.yml:android-build" || j.job === "ci.yml:ios-build");
  assert.deepEqual(
    caps.map((j) => [j.job, j.minutes]),
    [
      ["ci.yml:android-build", Number(rule[1])],
      ["ci.yml:ios-build", Number(rule[1])],
    ],
  );
});
