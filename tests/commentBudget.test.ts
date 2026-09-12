// tests/commentBudget.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { budget, diffOf, FORMAT } from "../scripts/comment-budget.mjs";

const diff = (file: string, lines: string[]) =>
  [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, "@@ -0,0 +1 @@", ...lines].join("\n");

const comments = (n: number) => Array.from({ length: n }, (_, i) => `+// line ${i}`);
const code = (n: number) => Array.from({ length: n }, (_, i) => `+const x${i} = ${i};`);
const prose = (n: number) => Array.from({ length: n }, (_, i) => `+  why ${i}`);

const counts = (d: string) =>
  budget(d).map(([f, n]: [string, { comment: number; code: number }]) => [f, n.comment, n.code]);

// `diffOf` decides how much context git prints, so what the window is worth can only be seen
// against a real repository: every fixture above hands `budget` a diff that was written by hand.
// `env` reaches the measured diff and not only the setup, so a `GIT_CONFIG_GLOBAL` or
// `GIT_CONFIG_SYSTEM` this machine keeps cannot red any of these — the rest of the environment is
// still inherited. `unpinned` is the same diff with the flags in `drop` taken away: what the check
// would have been handed had it not asked for that much of the format.
type GitSetup = { config?: Record<string, string>; attributes?: string; drop?: readonly string[] };

const diffAcross = (before: string[], after: string[], { config = {}, attributes = "", drop = [] }: GitSetup = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "comment-budget-"));
  const none = join(dir, "no-config");
  const env = { ...process.env, GIT_CONFIG_GLOBAL: none, GIT_CONFIG_SYSTEM: none, ...config };
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8", stdio: "pipe" });
  try {
    git("init", "-b", "main");
    if (attributes) writeFileSync(join(dir, ".gitattributes"), attributes + "\n");
    for (const [i, text] of [before, after].entries()) {
      writeFileSync(join(dir, "a.mjs"), text.join("\n") + "\n");
      git("add", "a.mjs");
      git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", `v${i}`);
    }
    const at = { cwd: dir, env };
    return {
      pinned: diffOf("HEAD~1", "HEAD", at),
      unpinned: diffOf("HEAD~1", "HEAD", at, FORMAT.filter((f) => !drop.includes(f))),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
};

const unprefixed = (lines: string[]) => lines.map((l) => l.slice(1));

// The window has to reach the opener of a block comment as long as any this repo actually writes,
// so that length is measured rather than restated: a docblock grown past `CONTEXT` reds the case
// below instead of quietly leaving an edit under it counted as code.
const longestBlock = (() => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const files = execFileSync("git", ["ls-files", "*.mjs", "*.js", "*.ts", "*.tsx"], { cwd: root, encoding: "utf8" });
  let longest = 0;
  for (const file of files.split("\n").filter(Boolean)) {
    let open = -1;
    readFileSync(join(root, file), "utf8")
      .split("\n")
      .forEach((line, i) => {
        const text = line.trim();
        if (open < 0) open = text.startsWith("/*") && !text.includes("*/") ? i : -1;
        else if (text.includes("*/")) {
          longest = Math.max(longest, i - open + 1);
          open = -1;
        }
      });
  }
  return longest;
})();

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
    // A scan that found nothing would build a one-line fixture and pass having measured nothing.
    assert.ok(longestBlock > 20, `scanned ${longestBlock} lines of block comment`);
    const head = ["/*", ...unprefixed(prose(longestBlock - 1))];
    const tail = ["*/", ...unprefixed(code(1))];
    const added = unprefixed(prose(8)).map((l) => `${l} also`);
    assert.deepEqual(counts(diffAcross([...head, ...tail], [...head, ...added, ...tail]).pinned), [["a.mjs", 8, 0]]);
  });

  // One change — over budget only if the diff reaches the check intact — run through a git
  // configured, or a repository marked up, every way that can empty this check out.
  const formatBefore = unprefixed(code(2));
  const formatAfter = [...formatBefore, ...unprefixed(comments(7)).map((l) => `${l} new`)];

  const oneGitConfig = (key: string, value: string) => ({
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: key,
    GIT_CONFIG_VALUE_0: value,
  });

  const FORMATS: { name: string; opts: GitSetup; fired: RegExp[]; flags: string[] }[] = [
    {
      name: "a machine that rewrites diff headers",
      opts: { config: oneGitConfig("diff.noprefix", "true") },
      fired: [/^diff --git a\.mjs a\.mjs$/m],
      flags: ["--src-prefix=a/", "--dst-prefix=b/"],
    },
    {
      name: "a source file marked binary",
      opts: { attributes: "*.mjs -diff" },
      fired: [/^Binary files /m],
      flags: ["--text"],
    },
    {
      name: "a machine that colours its diffs",
      opts: { config: oneGitConfig("color.ui", "always") },
      fired: [/^\x1b\[[\d;]*mdiff --git /m],
      flags: ["--no-color"],
    },
    {
      name: "a machine with an external differ",
      opts: { config: oneGitConfig("diff.external", "node --version") },
      fired: [/^v\d+\.\d+/m],
      flags: ["--no-ext-diff"],
    },
    {
      name: "a machine that converts a source file before diffing it",
      opts: { config: oneGitConfig("diff.blob.textconv", 'node -p "process.argv[1]"'), attributes: "*.mjs diff=blob" },
      // The hunk header is what separates this from the binary marker above: `budget` reads both as
      // a file with nothing in it, and only this one arrives with content that is not the file's.
      fired: [/^diff --git a\/a\.mjs b\/a\.mjs$/m, /^@@ /m],
      flags: ["--no-textconv"],
    },
  ];

  // Each case takes its own flags back off `FORMAT` and watches the check come back empty, so the
  // flags an entry names are the flags that answer it — asserted, rather than true by adjacency.
  for (const { name, opts, fired, flags } of FORMATS) {
    test(`${name} cannot empty the check out`, () => {
      const { pinned, unpinned } = diffAcross(formatBefore, formatAfter, { ...opts, drop: flags });
      for (const shape of fired) assert.match(unpinned, shape);
      assert.deepEqual(budget(unpinned), [], unpinned);
      assert.deepEqual(counts(pinned), [["a.mjs", 7, 0]], pinned);
    });
  }

  // The list rather than each entry: a seventh flag added to `FORMAT` with no case reds here, where
  // a sentence claiming one case per flag would have gone quietly wrong.
  test("every flag pinning the format is the answer to a case", () => {
    assert.deepEqual(FORMATS.flatMap((f) => f.flags).sort(), [...FORMAT].sort());
  });

  test("a context line is counted in neither column", () => {
    const before = [...unprefixed(code(12)), ...unprefixed(comments(6))];
    const after = [...before.slice(0, 9), ...unprefixed(comments(7)).map((l) => `${l} new`), ...before.slice(9)];
    assert.deepEqual(counts(diffAcross(before, after).pinned), [["a.mjs", 7, 0]]);
  });
});
