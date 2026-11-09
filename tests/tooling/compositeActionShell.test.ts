import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const root = path.resolve(import.meta.dirname, "../..");
const dir = path.join(root, ".github/actions");

/** `shell: bash` runs `bash -eo pipefail`, where `x=$(ls … | head -1)` dies before its ::error:: line can print. */
const PIPE_IN_SUBSTITUTION = /\$\([^)]*\|\s*(head|tail|grep)\b/;

export function pipefailSteps(text: string): string[] {
  const doc = parse(text) as { runs?: { steps?: { name?: string; shell?: string; run?: string }[] } };
  return (doc.runs?.steps ?? [])
    .filter((s) => s.run && s.shell === "bash" && PIPE_IN_SUBSTITUTION.test(s.run))
    .map((s) => s.name ?? s.run!.slice(0, 40));
}

test("no composite action step runs a piped substitution under the pipefail shell", () => {
  const bad: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const step of pipefailSteps(readFileSync(path.join(dir, entry.name, "action.yml"), "utf8"))) bad.push(`${entry.name}: ${step}`);
  }
  assert.deepEqual(bad, []);
});

test("the scan sees a planted pipefail step", () => {
  const planted = "runs:\n  steps:\n    - name: p\n      shell: bash\n      run: apk=$(ls *.apk | head -1)\n";
  assert.deepEqual(pipefailSteps(planted), ["p"]);
  assert.deepEqual(pipefailSteps(planted.replace("shell: bash", "shell: bash -e {0}")), []);
});
