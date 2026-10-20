// Device jobs run when a ticket's work needs one, dispatched on its branch, and on a schedule that
// keeps main's cache read — never on push or pull request (owner, 2026-09-24). An EAS job that exits on "accepted"
// reports a build it never saw finish (#1094).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadWorkflow, stepIn } from "../helpers/workflow.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

for (const name of ["ios.yml", "maestro.yml"]) {
  test(`${name} runs when dispatched, and on a schedule inside the cache's 7-day eviction`, () => {
    const on = loadWorkflow(name).on as Record<string, unknown>;
    assert.deepEqual(Object.keys(on), ["workflow_dispatch", "schedule"]);
    const crons = (on.schedule as { cron: string }[]).map((c) => c.cron.split(" "));
    assert.equal(crons.length, 1);
    const [, , dayOfMonth, month, dayOfWeek] = crons[0];
    assert.deepEqual([dayOfMonth, month], ["*", "*"]);
    const days = dayOfWeek === "*" ? [0] : dayOfWeek.split(",").map(Number).sort((a, b) => a - b);
    const gaps = days.map((d, i) => (days[(i + 1) % days.length] - d + 7) % 7 || 7);
    assert.ok(dayOfWeek === "*" || Math.max(...gaps) < 7, dayOfWeek);
  });
}

for (const [name, platform] of [
  ["ios.yml", "ios"],
  ["maestro.yml", "android"],
]) {
  test(`${name}: a native crash of the app fails the run (#1293)`, () => {
    const crash = stepIn(loadWorkflow(name), "Fail if the app died of a native crash").step;
    assert.equal(crash.if, "always()", "gating this on failure() hides a crash that did not manage to fail the run");
    const lastCommand = (crash.run ?? "").trimEnd().split("\n").reverse().find((line) => !line.trim().startsWith('"$'));
    assert.match(lastCommand ?? "", new RegExp(`^\\s*node tools/ci/find-native-crash\\.mjs ${platform} "\\$APP_ID"`));
    for (const escape of ["::warning::", "|| true"]) {
      assert.ok(!crash.run?.includes(escape), `${escape} lets a crash pass`);
    }
    assert.equal(crash["continue-on-error"], undefined, "continue-on-error lets a crash pass");
  });

  test(`${name}: a red scheduled run, and only a scheduled one, files in the tracker (#1293)`, () => {
    const workflow = loadWorkflow(name);
    const { id, job, step: report } = stepIn(workflow, "Report a red scheduled run to the tracker");
    assert.equal(report.if, "(failure() || cancelled()) && github.event_name == 'schedule'");
    assert.equal(report.run?.trim(), `bash tools/ci/report-device-run.sh ${name}`);
    assert.equal((job.permissions ?? workflow.permissions)?.issues, "write", "the report's job may not write issues");
    assert.equal(job.steps?.at(-1), report, "a step after the report can fail without being reported");
    assert.equal(Object.keys(workflow.jobs).at(-1), id, "a job after the report's can fail without being reported");
  });
}

test("ios.yml uploads the crash reports it failed on", () => {
  const workflow = loadWorkflow("ios.yml");
  const copyTo = /--copy-to "\$RUNNER_TEMP\/([\w-]+)"/.exec(stepIn(workflow, "Fail if the app died of a native crash").step.run ?? "")?.[1];
  assert.ok(copyTo, "the crash step no longer copies the reports out");
  const upload = stepIn(workflow, "Upload crash reports").step;
  assert.equal(upload.if, "always()");
  assert.ok(String(upload.with?.path).startsWith(`\${{ runner.temp }}/${copyTo}/`), String(upload.with?.path));
});

test("eas-build.yml waits for the build it starts", () => {
  const source = readFileSync(path.join(repoRoot, ".github/workflows/eas-build.yml"), "utf8")
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
  assert.match(source, /eas build /);
  assert.doesNotMatch(source, /--no-wait/);
});
