import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const root = path.resolve(import.meta.dirname, "..", "..");
const GATE =
  "github.run_attempt == 1 && (github.event_name == 'schedule' || startsWith(github.ref_name, 'agent/') || startsWith(github.ref_name, 'claude/'))";
const bare = (expr: unknown) => String(expr ?? "").replace(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/, "$1").replace(/\s+/g, " ").trim();

for (const wf of [".github/workflows/ios.yml", ".github/workflows/maestro.yml"]) {
  test(`${wf}: every job runs only on the first attempt of a schedule or a ticket branch`, () => {
    const jobs = Object.entries(parse(readFileSync(path.join(root, wf), "utf8")).jobs as Record<string, { if?: string }>);
    assert.ok(jobs.length > 0);
    for (const [name, job] of jobs) {
      assert.ok([GATE, `always() && ${GATE}`].includes(bare(job.if)), `${name}: if: ${job.if}`);
    }
  });
}
