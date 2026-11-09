import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const root = path.resolve(import.meta.dirname, "../..");

/** `shell: bash` runs `bash -eo pipefail`, where `x=$(ls … | head -1)` dies before its ::error:: line can print. */
export function runShells(text: string): (string | undefined)[] {
  const doc = parse(text) as { runs?: { steps?: { run?: string; shell?: string }[] } };
  return (doc.runs?.steps ?? []).filter((s) => s.run).map((s) => s.shell);
}

for (const action of ["diagnostics-android", "diagnostics-ios"]) {
  test(`${action}: every run step declares bash -e {0}`, () => {
    const shells = runShells(readFileSync(path.join(root, ".github/actions", action, "action.yml"), "utf8"));
    assert.ok(shells.length >= 4, `only ${shells.length} run steps found`);
    assert.deepEqual(shells.filter((s) => s !== "bash -e {0}"), []);
  });
}

test("the pin sees a planted pipefail step", () => {
  const planted = "runs:\n  steps:\n    - shell: bash\n      run: x\n";
  assert.deepEqual(runShells(planted), ["bash"]);
});
