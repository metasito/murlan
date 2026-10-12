import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { clampTimings } from "../../tools/ci/clamp-timings.mjs";
import { RATIO } from "../../tools/ci/e2e-budget.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

test("a spec measured past RATIO times its committed time keeps the committed time, and is named", () => {
  const { timings, kept } = clampTimings({ "tableProportions.spec.ts": 90, "cardScale.spec.ts": 10 }, { "tableProportions.spec.ts": 22.8, "cardScale.spec.ts": 5.8 });
  assert.deepEqual(timings, { "tableProportions.spec.ts": 22.8, "cardScale.spec.ts": 10 });
  assert.deepEqual(kept, [{ file: "tableProportions.spec.ts", measured: 90, committed: 22.8 }]);
  assert.equal(clampTimings({ "a.spec.ts": 20 * RATIO }, { "a.spec.ts": 20 }).timings["a.spec.ts"], 20 * RATIO);
});

test("a faster spec and a spec with no committed time take the measurement", () => {
  const { timings, kept } = clampTimings({ "tableProportions.spec.ts": 10, "brandNew.spec.ts": 300 }, { "tableProportions.spec.ts": 22.8 });
  assert.deepEqual(timings, { "tableProportions.spec.ts": 10, "brandNew.spec.ts": 300 });
  assert.deepEqual(kept, []);
});

test("the weekly commit clamps against the committed file, and again after re-deriving on a moved main", () => {
  const ci = readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8");
  const step = /- name: Commit the regenerated timings[\s\S]*?\n\n/.exec(ci)?.[0] ?? "";
  const clamp = /node tools\/ci\/clamp-timings\.mjs\n/g;
  assert.match(step, /node tools\/ci\/clamp-timings\.mjs\n\s+if git diff --quiet/);
  assert.match(step, /node tools\/ci\/e2e-timings\.mjs merged-report\.json\n\s+node tools\/ci\/clamp-timings\.mjs\n\s+done/);
  assert.equal(step.match(clamp)?.length, 2);
  assert.equal(ci.match(clamp)?.length, 2, "only the weekly commit clamps; the e2e-timings artefact keeps the measurements");
});
