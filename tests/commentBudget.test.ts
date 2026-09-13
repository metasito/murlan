// tests/commentBudget.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { addedCounts, over } from "../scripts/comment-budget.mjs";

const added = (...lines: string[]) => addedCounts("", lines.join("\n"));

describe("addedCounts classification", () => {
  test("a line comment is a comment", () => {
    assert.deepEqual(added("// why", "const a = 1;"), { comment: 1, code: 1 });
  });

  test("a block comment's body is prose whatever its lines start with", () => {
    assert.deepEqual(added("/*", "  why, with no asterisk", "*/", "const a = 1;"), { comment: 3, code: 1 });
  });

  test("a jsdoc block counts every line of itself", () => {
    assert.deepEqual(added("/**", " * why", " */", "export function f() {}"), { comment: 3, code: 1 });
  });

  test("a one-line block comment is one comment", () => {
    assert.deepEqual(added("/* why */ const a = 1;"), { comment: 1, code: 0 });
  });

  test("code after a block closes on the same line is still counted with the block", () => {
    assert.deepEqual(added("/*", "why", "*/ const a = 1;"), { comment: 3, code: 0 });
  });

  test("blank lines count as neither", () => {
    assert.deepEqual(added("const a = 1;", "", "   ", "const b = 2;"), { comment: 0, code: 2 });
  });

  test("a comment marker inside a string is not a comment", () => {
    assert.deepEqual(added('const url = "https://example.com";'), { comment: 0, code: 1 });
  });

  test("an empty file counts nothing", () => {
    assert.deepEqual(addedCounts("", ""), { comment: 0, code: 0 });
  });

  // The whole point of reading files rather than hunks: block state over a whole file has no
  // window to fall out of, so a body far below its `/*` is still prose.
  test("a long block stays open however far its close is", () => {
    const body = Array.from({ length: 200 }, (_, i) => `line ${i}`);
    assert.deepEqual(added("/*", ...body, "*/", "const a = 1;"), { comment: 202, code: 1 });
  });
});

describe("addedCounts against a before", () => {
  test("a line the file already held is not added", () => {
    assert.deepEqual(addedCounts("// why\nconst a = 1;", "// why\nconst a = 1;\nconst b = 2;"), { comment: 0, code: 1 });
  });

  test("a second copy of a line the file held once is added", () => {
    assert.deepEqual(addedCounts("// why", "// why\n// why"), { comment: 1, code: 0 });
  });

  test("reindenting a line does not add it", () => {
    assert.deepEqual(addedCounts("const a = 1;", "  if (x) {\n    const a = 1;\n  }"), { comment: 0, code: 2 });
  });

  test("deleting is never adding", () => {
    assert.deepEqual(addedCounts("// 1\n// 2\nconst a = 1;", "const a = 1;"), { comment: 0, code: 0 });
  });

  // Both columns undercount a line diff, and the undercount is one-sided: it can only name a
  // change a line diff would let through. Extracting a helper out of code that stays word for
  // word buys no budget for the prose written about it.
  test("code that only moved within the file is not added code", () => {
    const body = ["const a = 1;", "const b = 2;"];
    const before = body.join("\n");
    const after = ["function f() {", ...body, "}", "f();"].join("\n");
    assert.deepEqual(addedCounts(before, after), { comment: 0, code: 3 });
  });

  test("commenting a line out is prose, and uncommenting it is code", () => {
    assert.deepEqual(addedCounts("const a = 1;", "// const a = 1;"), { comment: 1, code: 0 });
    assert.deepEqual(addedCounts("/*\nconst a = 1;\n*/", "const a = 1;"), { comment: 0, code: 1 });
  });
});

describe("over", () => {
  const code = (n: number, tag = "x") => Array.from({ length: n }, (_, i) => `const ${tag}${i} = ${i};`);
  const prose = (n: number) => Array.from({ length: n }, (_, i) => `// why ${i}`);
  const delta = (before: string[], after: string[]) => addedCounts(before.join("\n"), after.join("\n"));

  test("a change that is mostly prose is named", () => {
    assert.equal(over(delta(["const a = 1;"], [...prose(7), "const a = 1;"])), true);
  });

  test("a handful of comments on a small change is not policed", () => {
    assert.equal(over(delta(["const a = 1;"], [...prose(2), "const a = 1;"])), false);
  });

  test("plenty of comments alongside plenty of code is within budget", () => {
    assert.equal(over(delta([], [...prose(20), ...code(40)])), false);
  });

  test("deleting comments is always free", () => {
    assert.equal(over(delta(prose(8), ["const a = 1;"])), false);
  });

  // Half the surviving lines come back word for word and half are rewritten, because a rewrite is
  // both: were every line new the fixture would pass on the rename alone.
  test("a rewrite that deletes far more code than it adds comment is within budget", () => {
    assert.equal(over(delta(code(200), [...prose(16), ...code(40), ...code(38, "y")])), false);
  });

  test("a large block of prose is named however much code the same change deleted", () => {
    assert.equal(over(delta(code(500), prose(400))), true);
  });

  test("a pile of prose beside one deletion is still named", () => {
    assert.equal(over(delta(["const a = 1;", "const b = 2;"], [...prose(30), "const a = 1;"])), true);
  });
});
