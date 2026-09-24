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

test("eas-build.yml waits for the build it starts", () => {
  const source = workflow("eas-build.yml");
  assert.match(source, /eas build /);
  assert.doesNotMatch(source, /--no-wait/);
});
