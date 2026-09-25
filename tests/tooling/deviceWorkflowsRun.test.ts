// Device jobs run when a ticket's work needs one, dispatched on its branch, and on a schedule that
// keeps main's cache read — never on push or pull request (owner, 2026-09-24). An EAS job that exits on "accepted"
// reports a build it never saw finish (#1094).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const workflow = (name: string) =>
  readFileSync(path.join(repoRoot, ".github/workflows", name), "utf8")
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

const triggers = (source: string) => source.match(/^on:\n((?:[ \t]+.*\n|\n)*)/m)?.[1] ?? "";

for (const name of ["ios.yml", "maestro.yml"]) {
  test(`${name} runs when dispatched, and on a schedule inside the cache's 7-day eviction`, () => {
    const on = triggers(workflow(name));
    assert.deepEqual(on.match(/^ {2}[\w-]+:/gm), ["  workflow_dispatch:", "  schedule:"]);
    const crons = [...on.matchAll(/- cron: "(.+)"/g)].map((m) => m[1].split(" "));
    assert.equal(crons.length, 1);
    const [, , dayOfMonth, month, dayOfWeek] = crons[0];
    assert.deepEqual([dayOfMonth, month], ["*", "*"]);
    const days = dayOfWeek === "*" ? [0] : dayOfWeek.split(",").map(Number).sort((a, b) => a - b);
    const gaps = days.map((d, i) => (days[(i + 1) % days.length] - d + 7) % 7 || 7);
    assert.ok(dayOfWeek === "*" || Math.max(...gaps) < 7, dayOfWeek);
  });
}

const step = (source: string, name: string) => {
  const start = source.indexOf(`- name: ${name}`);
  assert.notEqual(start, -1, `no step named "${name}"`);
  const end = source.indexOf("\n      - ", start);
  return source.slice(start, end === -1 ? undefined : end);
};

for (const [name, platform] of [
  ["ios.yml", "ios"],
  ["maestro.yml", "android"],
]) {
  test(`${name}: a native crash of the app fails the run (#1293)`, () => {
    const crash = step(workflow(name), "Fail if the app died of a native crash");
    assert.match(crash, /if: always\(\)/, "gating this on failure() hides a crash that did not manage to fail the run");
    const lastCommand = crash.trimEnd().split("\n").reverse().find((line) => !line.trim().startsWith('"$'));
    assert.match(lastCommand ?? "", new RegExp(`^ +node tools/ci/find-native-crash\\.mjs ${platform} "\\$APP_ID"`));
    for (const escape of ["::warning::", "|| true", "continue-on-error"]) {
      assert.ok(!crash.includes(escape), `${escape} lets a crash pass`);
    }
  });

  test(`${name}: a red scheduled run, and only a scheduled one, files in the tracker (#1293)`, () => {
    const source = workflow(name);
    const report = step(source, "Report a red scheduled run to the tracker");
    assert.match(report, /if: \(failure\(\) \|\| cancelled\(\)\) && github\.event_name == 'schedule'\n/);
    assert.match(report, new RegExp(`run: bash tools/ci/report-device-run\\.sh ${name.replace(".", "\\.")}\n?$`));
    assert.match(source, /^permissions:\n(?: {2}.*\n)* {2}issues: write$/m);
    assert.equal(source.trimEnd().endsWith(report.trimEnd()), true, "a step after the report can fail without being reported");
  });
}

test("ios.yml uploads the crash reports it failed on", () => {
  const source = workflow("ios.yml");
  const copyTo = /--copy-to "\$RUNNER_TEMP\/([\w-]+)"/.exec(step(source, "Fail if the app died of a native crash"))?.[1];
  assert.ok(copyTo, "the crash step no longer copies the reports out");
  const upload = step(source, "Upload crash reports");
  assert.match(upload, /if: always\(\)/);
  assert.match(upload, new RegExp(`path: \\$\\{\\{ runner\\.temp \\}\\}/${copyTo}/`));
});

test("eas-build.yml waits for the build it starts", () => {
  const source = workflow("eas-build.yml");
  assert.match(source, /eas build /);
  assert.doesNotMatch(source, /--no-wait/);
});
