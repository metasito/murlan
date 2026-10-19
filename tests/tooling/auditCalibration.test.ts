import { test } from "node:test";
import assert from "node:assert/strict";
import { hunkRanges, score } from "../../tools/audit/plantDefects.mjs";

const DIFF = [
  "diff --git a/lib/a.ts b/lib/a.ts",
  "--- a/lib/a.ts",
  "+++ b/lib/a.ts",
  "@@ -10,2 +10,3 @@ fn",
  "@@ -40,3 +41,0 @@ fn",
  "diff --git a/server/b.ts b/server/b.ts",
  "--- a/server/b.ts",
  "+++ b/server/b.ts",
  "@@ -5 +5 @@",
].join("\n");

test("a planted defect's place is every hunk it changed, a deletion included", () => {
  assert.deepEqual(hunkRanges(DIFF), [
    { path: "lib/a.ts", start: 10, end: 12 },
    { path: "lib/a.ts", start: 41, end: 41 },
    { path: "server/b.ts", start: 5, end: 5 },
  ]);
});

test("recall counts a defect caught only by a finding the skeptics kept", () => {
  const planted = [
    { issue: 1, title: "kept", locations: [{ path: "lib/a.ts", start: 10, end: 12 }] },
    { issue: 2, title: "talked out of", locations: [{ path: "server/b.ts", start: 5, end: 5 }] },
    { issue: 3, title: "never seen", locations: [{ path: "app/c.tsx", start: 100, end: 100 }] },
  ];
  const judged = [
    { title: "near the plant", verdict: "proven", locations: [{ path: "lib/a.ts", line: 20 }] },
    { title: "refuted", verdict: "refuted", locations: [{ path: "server/b.ts", line: 6 }] },
    { title: "same file, far away", verdict: "upheld", locations: [{ path: "app/c.tsx", line: 400 }] },
  ];
  const result = score(planted, judged);
  assert.deepEqual(result.rows.map((r) => r.verdict), ["caught", "refuted", "missed"]);
  assert.equal(result.recall, 1 / 3);
});
