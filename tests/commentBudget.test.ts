// tests/commentBudget.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { budget, diffOf } from "../scripts/comment-budget.mjs";

const diff = (file: string, lines: string[]) =>
  [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, "@@ -0,0 +1 @@", ...lines].join("\n");

const comments = (n: number) => Array.from({ length: n }, (_, i) => `+// line ${i}`);
const code = (n: number) => Array.from({ length: n }, (_, i) => `+const x${i} = ${i};`);
const prose = (n: number) => Array.from({ length: n }, (_, i) => `+  why ${i}`);

const counts = (d: string) =>
  budget(d).map(([f, n]: [string, { comment: number; code: number }]) => [f, n.comment, n.code]);

// `diffOf` decides how much context git prints, so what the window is worth can only be seen
// against a real repository: every fixture above hands `budget` a diff that was written by hand.
// `gpgsign` is off because a machine signing globally would fail the commit and red these cases
// for a reason that is not the check's.
const diffAcross = (before: string[], after: string[]) => {
  const dir = mkdtempSync(join(tmpdir(), "comment-budget-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  const cwd = process.cwd();
  try {
    git("init", "-b", "main");
    for (const [i, text] of [before, after].entries()) {
      writeFileSync(join(dir, "a.mjs"), text.join("\n") + "\n");
      git("add", "a.mjs");
      git("-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", "commit", "-m", `v${i}`);
    }
    process.chdir(dir);
    return diffOf("HEAD~1");
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
};

const unsigned = (lines: string[]) => lines.map((l) => l.slice(1));

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

  test("a comment the same diff deletes elsewhere moved rather than being written", () => {
    const from = diff("scripts/a.mjs", [...comments(10).map((l) => `-${l.slice(1)}`)]);
    const to = diff("scripts/b.mjs", [...comments(10), ...code(1)]);
    assert.equal(budget(`${from}\n${to}`).length, 0);
  });

  test("each deletion pays for one addition and no more", () => {
    const from = diff("scripts/a.mjs", [`-${comments(1)[0].slice(1)}`]);
    const to = diff("scripts/b.mjs", [...comments(10), ...code(1)]);
    // Nine of the ten are new prose, so the file is still over.
    assert.deepEqual(counts(`${from}\n${to}`), [["scripts/b.mjs", 9, 1]]);
  });

  test("a comment deleted from a file this check ignores funds nothing", () => {
    const from = diff("docs/a.md", [...comments(10).map((l) => `-${l.slice(1)}`)]);
    const to = diff("scripts/b.mjs", [...comments(10), ...code(1)]);
    assert.deepEqual(counts(`${from}\n${to}`), [["scripts/b.mjs", 10, 1]]);
  });

  test("a deleted line shaped like a file header does not re-arm the credit pool", () => {
    // Reaches the parser as `--- a/scripts/z.mjs`, which is the `---` header's own shape.
    const from = diff("docs/a.md", ["--- a/scripts/z.mjs", ...comments(10).map((l) => `-${l.slice(1)}`)]);
    const to = diff("scripts/b.mjs", [...comments(10), ...code(1)]);
    assert.deepEqual(counts(`${from}\n${to}`), [["scripts/b.mjs", 10, 1]]);
  });

  test("block-comment bodies count", () => {
    const lines = ["+/**", ...Array.from({ length: 8 }, () => "+ * why"), "+ */", "+const x = 1;"];
    assert.equal(budget(diff("scripts/a.mjs", lines))[0][1].comment, 10);
  });

  test("a block-comment body counts without leading asterisks", () => {
    const lines = ["+/*", ...prose(8), "+*/", ...code(1)];
    assert.deepEqual(counts(diff("scripts/a.mjs", lines)), [["scripts/a.mjs", 10, 1]]);
  });

  test("a block comment opening and closing on one line opens no block", () => {
    const lines = ["+/* why */", ...code(2), "+/*", ...prose(8), "+*/"];
    assert.deepEqual(counts(diff("scripts/a.mjs", lines)), [["scripts/a.mjs", 11, 2]]);
  });

  test("a block comment the same diff deletes elsewhere moved rather than being written", () => {
    const body = ["+/*", ...prose(8), "+*/"];
    const from = diff("scripts/a.mjs", body.map((l) => `-${l.slice(1)}`));
    const to = diff("scripts/b.mjs", [...body, ...code(1)]);
    assert.deepEqual(counts(`${from}\n${to}`), []);
  });

  test("a `*/` arriving as a context line closes the block", () => {
    const lines = ["+/*", ...prose(2), " */", ...code(12), ...comments(7)];
    assert.deepEqual(counts(diff("scripts/a.mjs", lines)), []);
  });

  test("a block comment left open at the end of a hunk does not reach the next", () => {
    const lines = ["+/*", ...prose(2), "@@ -20,0 +20 @@", ...code(12), ...comments(7)];
    assert.deepEqual(counts(diff("scripts/a.mjs", lines)), []);
  });

  test("prose added inside a block comment already in the file counts", () => {
    const lines = [" /*", ...prose(8), " */", ...code(1)];
    assert.deepEqual(counts(diff("scripts/a.mjs", lines)), [["scripts/a.mjs", 8, 1]]);
  });

  test("a body whose opener falls outside the hunk reads as code", () => {
    const lines = ["+/*", ...prose(2), "@@ -20,0 +20 @@", ...prose(9), ...comments(7)];
    assert.deepEqual(counts(diff("scripts/a.mjs", lines)), [["scripts/a.mjs", 10, 9]]);
  });

  test("a blank line in a block comment counts as neither", () => {
    const lines = ["+/*", "+", ...prose(8), "+*/", ...code(1)];
    assert.deepEqual(counts(diff("scripts/a.mjs", lines)), [["scripts/a.mjs", 10, 1]]);
  });

  test("an unterminated block comment does not swallow the next file", () => {
    const from = diff("scripts/a.mjs", ["+/*", ...prose(2)]);
    const to = diff("scripts/b.mjs", [...comments(7), ...code(1)]);
    assert.deepEqual(counts(`${from}\n${to}`), [["scripts/b.mjs", 7, 1]]);
  });

  test("prose added far below a block comment's opener counts as prose", () => {
    const head = ["/*", ...unsigned(prose(5))];
    const tail = ["*/", ...unsigned(code(1))];
    const added = unsigned(prose(8)).map((l) => `${l} also`);
    assert.deepEqual(counts(diffAcross([...head, ...tail], [...head, ...added, ...tail])), [["a.mjs", 8, 0]]);
  });

  // Both halves, in one case: the window has to reach the far line for the first assertion to
  // hold, and the lines it reaches have to stay out of both columns for the second.
  test("the context a wide window prints is counted in neither column", () => {
    const before = [...unsigned(code(20)), ...unsigned(comments(6))];
    const after = [...before.slice(0, 20), ...unsigned(comments(7)).map((l) => `${l} new`), ...before.slice(20)];
    const printed = diffAcross(before, after);
    assert.ok(printed.includes(`\n ${before[0]}`), "the window falls short of the file's first line");
    assert.deepEqual(counts(printed), [["a.mjs", 7, 0]]);
  });
});
