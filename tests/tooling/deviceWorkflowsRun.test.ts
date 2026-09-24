// Device jobs run when a ticket's work needs one, dispatched on its branch, and on a merge to
// main — never on a schedule or pull request (owner, 2026-09-24). An EAS job that exits on "accepted"
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
  test(`${name} runs when dispatched, and on a push to main only`, () => {
    const on = triggers(workflow(name));
    assert.deepEqual(on.match(/^ {2}[\w-]+:/gm), ["  workflow_dispatch:", "  push:"]);
    assert.match(on, /^ {2}push:\n {4}branches: \[main\]\n(?! {4})/m);
  });
}

test("eas-build.yml waits for the build it starts", () => {
  const source = workflow("eas-build.yml");
  assert.match(source, /eas build /);
  assert.doesNotMatch(source, /--no-wait/);
});
