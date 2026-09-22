import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workflowsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".github", "workflows");

/** Every job in every workflow, with whether it declares its own `timeout-minutes`. */
function jobs(): { job: string; capped: boolean }[] {
  return readdirSync(workflowsDir)
    .filter((f) => /\.ya?ml$/.test(f))
    .flatMap((file) => {
      const body = readFileSync(path.join(workflowsDir, file), "utf8").split(/^jobs:\s*$/m)[1] ?? "";
      return [...body.matchAll(/^  ([\w-]+):\s*$([\s\S]*?)(?=^  [\w-]+:\s*$|(?![\s\S]))/gm)].map((m) => ({
        job: `${file}:${m[1]}`,
        capped: /^    timeout-minutes:/m.test(m[2]),
      }));
    });
}

test("every CI job caps its own run time", () => {
  const all = jobs();
  assert.ok(all.length >= 15, `found only ${all.length} jobs; the parser no longer sees the workflows`);
  assert.deepEqual(all.filter((j) => !j.capped).map((j) => j.job), [], "a hung job without a cap runs for GitHub's 6-hour default");
});
