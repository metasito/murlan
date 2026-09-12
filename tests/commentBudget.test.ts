// tests/commentBudget.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { countComments, over } from "../scripts/comment-budget.mjs";

const count = (...lines: string[]) => countComments(lines.join("\n"));

describe("countComments", () => {
  test("a line comment is a comment", () => {
    assert.deepEqual(count("// why", "const a = 1;"), { comment: 1, code: 1 });
  });

  test("a block comment's body is prose whatever its lines start with", () => {
    assert.deepEqual(count("/*", "  why, with no asterisk", "*/", "const a = 1;"), { comment: 3, code: 1 });
  });

  test("a jsdoc block counts every line of itself", () => {
    assert.deepEqual(count("/**", " * why", " */", "export function f() {}"), { comment: 3, code: 1 });
  });

  test("a one-line block comment is one comment", () => {
    assert.deepEqual(count("/* why */ const a = 1;"), { comment: 1, code: 0 });
  });

  test("code after a block closes on the same line is still counted with the block", () => {
    assert.deepEqual(count("/*", "why", "*/ const a = 1;"), { comment: 3, code: 0 });
  });

  test("blank lines count as neither", () => {
    assert.deepEqual(count("const a = 1;", "", "   ", "const b = 2;"), { comment: 0, code: 2 });
  });

  test("a comment marker inside a string is not a comment", () => {
    assert.deepEqual(count('const url = "https://example.com";'), { comment: 0, code: 1 });
  });

  test("an empty file counts nothing", () => {
    assert.deepEqual(countComments(""), { comment: 0, code: 0 });
  });

  // The whole point of counting files rather than hunks: block state over a whole file has no
  // window to fall out of, so a body far below its `/*` is still prose.
  test("a long block stays open however far its close is", () => {
    const body = Array.from({ length: 200 }, (_, i) => `line ${i}`);
    assert.deepEqual(count("/*", ...body, "*/", "const a = 1;"), { comment: 202, code: 1 });
  });
});

describe("over", () => {
  const delta = (before: string, after: string) => ({ before: countComments(before), after: countComments(after) });

  test("a change that is mostly prose is named", () => {
    const { before, after } = delta("const a = 1;", ["// 1", "// 2", "// 3", "// 4", "// 5", "// 6", "// 7", "const a = 1;"].join("\n"));
    assert.equal(over(before, after), true);
  });

  test("a handful of comments on a small change is not policed", () => {
    const { before, after } = delta("const a = 1;", ["// 1", "// 2", "const a = 1;"].join("\n"));
    assert.equal(over(before, after), false);
  });

  test("plenty of comments alongside plenty of code is within budget", () => {
    const code = Array.from({ length: 40 }, (_, i) => `const x${i} = ${i};`);
    const prose = Array.from({ length: 20 }, (_, i) => `// why ${i}`);
    const { before, after } = delta("", [...prose, ...code].join("\n"));
    assert.equal(over(before, after), false);
  });

  test("deleting comments is always free", () => {
    const { before, after } = delta(["// 1", "// 2", "// 3", "// 4", "// 5", "// 6", "// 7", "// 8"].join("\n"), "const a = 1;");
    assert.equal(over(before, after), false);
  });

  // Measured against the net, a file that shrinks puts the bar below zero: the rewrite that
  // deleted 122 lines of queue-loop.mjs failed the check for sixteen JSDoc contracts.
  test("a rewrite that deletes far more code than it adds comment is within budget", () => {
    const code = (n: number) => Array.from({ length: n }, (_, i) => `const x${i} = ${i};`);
    const prose = Array.from({ length: 16 }, (_, i) => `// why ${i}`);
    const { before, after } = delta(code(200).join("\n"), [...prose, ...code(78)].join("\n"));
    assert.equal(over(before, after), false);
  });

  // Deleting a line must not buy an unlimited comment budget. It buys one the size of the
  // deletion, which is #1001.
  test("a pile of prose beside one deletion is still named", () => {
    const prose = Array.from({ length: 30 }, (_, i) => `// why ${i}`);
    const { before, after } = delta(["const a = 1;", "const b = 2;"].join("\n"), [...prose, "const a = 1;"].join("\n"));
    assert.equal(over(before, after), true);
  });
});
