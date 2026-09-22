// tools/loop/tests/commentBudget.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { floorFor } from "../commentShape.ts";
import { addedCounts, budget, over } from "../comment-budget.mjs";

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

  test("code that only moved within the file is not added code", () => {
    const body = ["const a = 1;", "const b = 2;"];
    const before = body.join("\n");
    const after = ["function f() {", ...body, "}", "f();"].join("\n");
    assert.deepEqual(addedCounts(before, after), { comment: 0, code: 3 });
  });

  test("prose that only moved within the file is not added prose", () => {
    const body = ["// why", "// how", "const a = 1;"];
    assert.deepEqual(addedCounts(body.join("\n"), [body[2], body[0], body[1]].join("\n")), { comment: 0, code: 0 });
  });

  test("repointing a comment at a moved file is not added prose", () => {
    assert.deepEqual(
      addedCounts("// see docs/OLD.md §11\n// and notes.md", "// see docs/NEW.md §11\n// and docs/RUNBOOK.md"),
      { comment: 0, code: 0 },
    );
  });

  test("rewording the prose around a path is added prose", () => {
    assert.deepEqual(addedCounts("// see docs/OLD.md", "// read docs/OLD.md first"), { comment: 1, code: 0 });
  });

  test("a path comment does not spend a bare comment marker", () => {
    assert.deepEqual(addedCounts("//", "// docs/OLD.md"), { comment: 1, code: 0 });
  });

  test("repointing a path in code is added code", () => {
    assert.deepEqual(addedCounts('const p = "docs/OLD.md";', 'const p = "docs/NEW.md";'), { comment: 0, code: 1 });
  });

  test("prefixing a line with // is prose the change wrote", () => {
    assert.deepEqual(addedCounts("const a = 1;", "// const a = 1;"), { comment: 1, code: 0 });
  });

  // A pool blind to kind lets the deleted code pay for the prose, and twenty commented-out lines
  // cost the two delimiters. The budget is what a reader has to get past, so they cost twenty-two.
  test("commenting a block out is prose the change wrote, line for line", () => {
    const body = Array.from({ length: 20 }, (_, i) => `const x${i} = ${i};`);
    assert.deepEqual(addedCounts(body.join("\n"), ["/*", ...body, "*/"].join("\n")), { comment: 22, code: 0 });
  });

  test("uncommenting a block is code the change wrote", () => {
    const body = Array.from({ length: 20 }, (_, i) => `const x${i} = ${i};`);
    assert.deepEqual(addedCounts(["/*", ...body, "*/"].join("\n"), body.join("\n")), { comment: 0, code: 20 });
  });
});

describe("over", () => {
  const code = (n: number, tag = "x") => Array.from({ length: n }, (_, i) => `const ${tag}${i} = ${i};`);
  const prose = (n: number) => Array.from({ length: n }, (_, i) => `// why ${i}`);
  const delta = (before: string[], after: string[]) =>
    over(addedCounts(before.join("\n"), after.join("\n")), "src/a.mjs");

  test("a change that is mostly prose is named", () => {
    assert.equal(delta(["const a = 1;"], [...prose(7), "const a = 1;"]), true);
  });

  test("a handful of comments on a small change is not policed", () => {
    assert.equal(delta(["const a = 1;"], [...prose(2), "const a = 1;"]), false);
  });

  test("plenty of comments alongside plenty of code is within budget", () => {
    assert.equal(delta([], [...prose(20), ...code(40)]), false);
  });

  test("deleting comments is always free", () => {
    assert.equal(delta(prose(8), ["const a = 1;"]), false);
  });

  // Half the surviving lines come back word for word and half are rewritten, because a rewrite is
  // both: were every line new the fixture would pass on the rename alone.
  test("a rewrite that deletes far more code than it adds comment is within budget", () => {
    assert.equal(delta(code(200), [...prose(16), ...code(40), ...code(38, "y")]), false);
  });

  test("a large block of prose is named however much code the same change deleted", () => {
    assert.equal(delta(code(500), prose(400)), true);
  });

  test("a pile of prose beside one deletion is still named", () => {
    assert.equal(delta(["const a = 1;", "const b = 2;"], [...prose(30), "const a = 1;"]), true);
  });
});

/**
 * Three sites quote CLAUDE.md at a model whose write they refuse, and the budget they enforce is
 * published there as a number. An authority quoted from memory is one the next edit to it silently
 * falsifies — this branch deleted that very sentence and left all three citing it.
 */
describe("the budget CLAUDE.md publishes is the budget the code enforces", () => {
  // Whitespace collapsed: the file is hard-wrapped, so every phrase worth pinning straddles a line.
  const claude = readFileSync(new URL("../../../CLAUDE.md", import.meta.url), "utf8")
    .toLowerCase()
    .replace(/\s+/g, " ");
  const says = (text: string) =>
    assert.ok(claude.includes(text.toLowerCase()), `CLAUDE.md no longer says "${text}"`);

  test("the sentence the enforcers quote back is still in it", () => {
    says("a change adding more comment lines than code is explaining itself instead of being clear");
  });

  test("the history rule the hook denies on is still in it", () => {
    says("history of what it was");
  });

  test("the floors it publishes are the floors floorFor returns", () => {
    assert.equal(floorFor("src/x.ts"), 6);
    says("more than six comment lines");
    assert.equal(floorFor("x.test.ts"), 3);
    says("three in a test");
  });

  test("the prose-only floor is published too, not only enforced", () => {
    assert.equal(over({ comment: 3, code: 0 }, "src/x.ts"), true);
    assert.equal(over({ comment: 2, code: 0 }, "src/x.ts"), false);
    says("adds no code at all is over it at three");
  });

  test("it says which revision the count is against", () => {
    says("origin/main");
  });
});

describe("the budget's floors", () => {
  test("a comment-only change cannot be saved by the ratio arm", () => {
    assert.equal(over({ comment: 4, code: 0 }, "src/x.ts"), true);
  });

  test("a one-line comment-only change still passes", () => {
    assert.equal(over({ comment: 1, code: 0 }, "src/x.ts"), false);
  });

  test("a test file gets the tighter floor", () => {
    assert.equal(over({ comment: 4, code: 2 }, "src/x.ts"), false);
    assert.equal(over({ comment: 4, code: 2 }, "tools/loop/tests/x.test.ts"), true);
  });

  test("source keeps the floor it had", () => {
    assert.equal(over({ comment: 6, code: 2 }, "src/x.ts"), false);
    assert.equal(over({ comment: 7, code: 2 }, "src/x.ts"), true);
  });

  test("a comment marker inside a string was never a comment", () => {
    assert.deepEqual(addedCounts("", `const s = "// x";`), { comment: 0, code: 1 });
  });
});

describe("budget", () => {
  // The caller's own git config reaches a temp repo: a global `commit.gpgsign` or `core.hooksPath`
  // fails or hangs the commits below.
  const run = (dir: string, ...args: string[]) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_GLOBAL: join(dir, "nonexistent"), GIT_CONFIG_SYSTEM: join(dir, "nonexistent") },
    });

  // The one thing reading the source cannot settle: which revision the "before" content comes
  // from. Taken from `base`'s tip, the branch is charged for prose main drops after it forked.
  test("content comes from the merge base, not the base's tip", () => {
    const dir = mkdtempSync(join(tmpdir(), "comment-budget-"));
    const cwd = process.cwd();
    const file = join(dir, "a.mjs");
    try {
      run(dir, "init", "-q", "-b", "main");
      run(dir, "config", "user.email", "t@example.com");
      run(dir, "config", "user.name", "t");
      const prose = (tag: string) => Array.from({ length: 20 }, (_, i) => `// ${tag} ${i}`);
      writeFileSync(file, [...prose("why"), "const a = 1;"].join("\n"));
      run(dir, "add", "--", "a.mjs");
      run(dir, "commit", "-qm", "base");
      run(dir, "checkout", "-qb", "branch");
      writeFileSync(file, [...prose("why"), "const a = 1;", "const b = 2;"].join("\n"));
      run(dir, "commit", "-qam", "one line of code");
      run(dir, "checkout", "-q", "main");
      writeFileSync(file, "const a = 1;");
      run(dir, "commit", "-qam", "main drops the prose");
      run(dir, "checkout", "-q", "branch");
      process.chdir(dir);

      assert.deepEqual(budget("main"), []);

      // The control: the same file, examined by the same call, is named when the prose is new.
      writeFileSync(file, [...prose("why"), ...prose("how"), "const a = 1;", "const b = 2;"].join("\n"));
      assert.deepEqual(budget("main"), [
        ["a.mjs", { comment: 20, code: 1 }],
        ["(branch total)", { comment: 20, code: 1 }],
      ]);
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    }
  });

  const onBranch = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "comment-budget-"));
    const cwd = process.cwd();
    try {
      run(dir, "init", "-q", "-b", "main");
      run(dir, "config", "user.email", "t@example.com");
      run(dir, "config", "user.name", "t");
      run(dir, "commit", "-q", "--allow-empty", "-m", "base");
      run(dir, "checkout", "-qb", "branch");
      for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
      run(dir, "add", "--", ...Object.keys(files));
      run(dir, "commit", "-qm", "branch");
      process.chdir(dir);
      return budget("main");
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    }
  };
  const shaped = (tag: string, comments: number, code: number) =>
    [
      ...Array.from({ length: comments }, (_, i) => `// ${tag} why ${i}`),
      ...Array.from({ length: code }, (_, i) => `const ${tag}${i} = ${i};`),
    ].join("\n");

  test("prose spread thinly across files is judged as the branch's total", () => {
    const files = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`f${i}.mjs`, shaped(`f${i}`, 6, 1)]));
    assert.deepEqual(onBranch(files), [["(branch total)", { comment: 60, code: 10 }]]);
  });

  test("a moved file is judged against the path it moved from", () => {
    const dir = mkdtempSync(join(tmpdir(), "comment-budget-"));
    const cwd = process.cwd();
    try {
      run(dir, "init", "-q", "-b", "main");
      run(dir, "config", "user.email", "t@example.com");
      run(dir, "config", "user.name", "t");
      writeFileSync(join(dir, "a.mjs"), shaped("a", 20, 2));
      run(dir, "add", "--", "a.mjs");
      run(dir, "commit", "-qm", "base");
      run(dir, "checkout", "-qb", "branch");
      run(dir, "mv", "a.mjs", "b.mjs");
      run(dir, "commit", "-qm", "move");
      process.chdir(dir);
      assert.deepEqual(budget("main"), []);
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    }
  });

  test("a .cjs file is counted, as the write hook judges it", () => {
    assert.deepEqual(onBranch({ "a.cjs": shaped("a", 7, 1) }), [
      ["a.cjs", { comment: 7, code: 1 }],
      ["(branch total)", { comment: 7, code: 1 }],
    ]);
  });
});
