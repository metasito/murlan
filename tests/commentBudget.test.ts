// tests/commentBudget.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { budget } from "../scripts/comment-budget.mjs";

const diff = (file: string, lines: string[]) =>
  [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, "@@ -0,0 +1 @@", ...lines].join("\n");

const comments = (n: number) => Array.from({ length: n }, (_, i) => `+// line ${i}`);
const code = (n: number) => Array.from({ length: n }, (_, i) => `+const x${i} = ${i};`);

describe("comment budget", () => {
  test("a diff that is mostly prose is over", () => {
    const over = budget(diff("scripts/a.mjs", [...comments(10), ...code(3)]));
    assert.deepEqual(
      over.map(([f, n]: [string, { comment: number; code: number }]) => [f, n.comment, n.code]),
      [["scripts/a.mjs", 10, 3]]
    );
  });

  test("more code than comment is within budget", () => {
    assert.equal(budget(diff("scripts/a.mjs", [...comments(10), ...code(11)])).length, 0);
  });

  test("a few comments on a small change is not a ratio worth policing", () => {
    assert.equal(budget(diff("scripts/a.mjs", [...comments(6), ...code(1)])).length, 0);
  });

  test("deleting comments is free", () => {
    const lines = [...comments(10).map((l) => l.replace("+", "-")), ...code(1)];
    assert.equal(budget(diff("scripts/a.mjs", lines)).length, 0);
  });

  test("non-source files are not counted", () => {
    assert.equal(budget(diff("docs/a.md", [...comments(20)])).length, 0);
  });

  test("block-comment bodies count", () => {
    const lines = ["+/**", ...Array.from({ length: 8 }, () => "+ * why"), "+ */", "+const x = 1;"];
    assert.equal(budget(diff("scripts/a.mjs", lines))[0][1].comment, 10);
  });
});
