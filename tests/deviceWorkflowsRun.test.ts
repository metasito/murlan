// A device job only a human dispatches goes stale unnoticed, and an EAS job that
// exits on "accepted" reports a build it never saw finish (#1094).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflow = (name: string) =>
  readFileSync(path.join(repoRoot, ".github/workflows", name), "utf8")
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

const triggers = (source: string) => source.match(/^on:\n((?:[ \t]+.*\n|\n)*)/m)?.[1] ?? "";

for (const name of ["ios.yml", "maestro.yml"]) {
  test(`${name} runs on a schedule as well as by hand`, () => {
    const on = triggers(workflow(name));
    assert.match(on, /^ {2}schedule:\n {4}- cron: "[^"]+"/m);
    assert.match(on, /^ {2}workflow_dispatch:/m);
  });
}

test("eas-build.yml waits for the build it starts", () => {
  const source = workflow("eas-build.yml");
  assert.match(source, /eas build /);
  assert.doesNotMatch(source, /--no-wait/);
});
