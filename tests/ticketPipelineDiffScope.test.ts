// tests/ticketPipelineDiffScope.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { pickDiffScope, INLINE_DIFF_LINE_LIMIT } from "../lib/ticketPipeline/diffScope.ts";

function linesOf(count: number): string {
  return Array.from({ length: count }, (_, i) => `+line ${i}`).join("\n");
}

describe("deciding whether a diff is small enough to inline into a review prompt", () => {
  test("a small diff is inlined", () => {
    const scope = pickDiffScope(linesOf(12));
    assert.deepEqual(scope, { inline: true, lineCount: 12 });
  });

  test("a diff exactly at the limit is still inlined", () => {
    const scope = pickDiffScope(linesOf(INLINE_DIFF_LINE_LIMIT));
    assert.deepEqual(scope, { inline: true, lineCount: INLINE_DIFF_LINE_LIMIT });
  });

  test("a diff one line past the limit falls back to the command", () => {
    const scope = pickDiffScope(linesOf(INLINE_DIFF_LINE_LIMIT + 1));
    assert.deepEqual(scope, { inline: false, lineCount: INLINE_DIFF_LINE_LIMIT + 1 });
  });

  test("a large diff is not inlined", () => {
    const scope = pickDiffScope(linesOf(2000));
    assert.equal(scope.inline, false);
  });

  test("an empty diff is not inlined — there is nothing to paste", () => {
    assert.deepEqual(pickDiffScope(""), { inline: false, lineCount: 0 });
  });

  test("a trailing newline from the git diff command doesn't inflate the count", () => {
    const scope = pickDiffScope(linesOf(5) + "\n");
    assert.equal(scope.lineCount, 5);
  });
});
