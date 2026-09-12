/**
 * CLAUDE.md: "A change adding more comment lines than code lines is explaining itself instead of
 * being clear." That rule was in context for every change this repo has ever seen, and it is broken
 * regularly — so it is a check rather than a sentence.
 *
 * Counts only added lines, against a base. Deletions are free: taking comments out is always fine,
 * and a comment line the same diff deletes elsewhere moved rather than being written.
 *
 * Usage: node scripts/comment-budget.mjs [base]   (default origin/main)
 *        exit 0 - within budget; exit 1 - names the files over it
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const CODE = /\.(mjs|js|ts|tsx)$/;
const LINE = /^\+\s*(\/\/|\*|\/\*)/;
const OPENS = /^\+\s*\/\*/;

export function budget(diff) {
  const files = new Map();
  const lines = diff.split("\n");

  // The `diff --git` header, not the `---`/`+++` pair: every line of content carries a
  // `+`, `-` or space, so only a header can be unprefixed and no line can impersonate one.
  // Returns undefined for "not a header" and null for "a header this check ignores" — test
  // for undefined, not truth, or an ignored file leaves the previous one's name standing.
  const pathOf = (line) => {
    const named = /^diff --git a\/.+ b\/(.+)$/.exec(line);
    return named ? (CODE.test(named[1]) ? named[1] : null) : undefined;
  };

  // One side of the diff, as `[file, text, comment]` per line of its own; both passes read it,
  // so what a comment is gets decided once. A block comment's body is prose whatever its lines
  // start with — the leading `*` is a convention, not the syntax. A context line opens and closes
  // a block without being counted in either version. Block state is per hunk, and that is the
  // ceiling: a body whose `/*` falls outside the hunk reads as code.
  function* side(sign) {
    let file = null;
    let block = false;
    for (const line of lines) {
      const named = pathOf(line);
      if (named !== undefined || line.startsWith("@@")) {
        if (named !== undefined) file = named;
        block = false;
        continue;
      }
      if (!file || line.startsWith("+++") || line.startsWith("---")) continue;
      const own = line.startsWith(sign);
      if (!own && !line.startsWith(" ")) continue;
      const text = "+" + line.slice(1);
      const open = block || OPENS.test(text);
      block = open && !text.includes("*/");
      const body = line.slice(1).trim();
      if (own && body) yield [file, body, open || LINE.test(text)];
    }
  }

  // A comment line the diff also deletes somewhere is prose that moved, not prose
  // that was written: an extraction carries a function's docstring to its new file,
  // and counting that as explanation would price documenting a small function out of
  // ever being moved. Matched on the exact text, and each deletion pays for one
  // addition, so no amount of new prose can hide behind it — and credit is minted
  // only in the files it can be spent in, or deleting a doc would fund a docstring.
  const moved = new Map();
  for (const [, text, comment] of side("-")) {
    if (comment) moved.set(text, (moved.get(text) ?? 0) + 1);
  }

  for (const [file, text, comment] of side("+")) {
    if (!files.has(file)) files.set(file, { comment: 0, code: 0 });
    const at = files.get(file);
    if (!comment) {
      at.code += 1;
      continue;
    }
    const left = moved.get(text) ?? 0;
    if (left) moved.set(text, left - 1);
    else at.comment += 1;
  }
  // A handful of comments on a small change is not a ratio worth policing; the rule is about a diff
  // that is mostly prose.
  return [...files].filter(([, n]) => n.comment > 6 && n.comment > n.code);
}

// Block state is per hunk, so the window must clear the longest block comment this repo writes —
// `tests/commentBudget.test.ts` measures that and reds when this stops covering it.
const CONTEXT = 40;

// The output format is demanded rather than hoped for: an external differ, `diff.noprefix` and
// `color.ui` leave this no file to parse; textconv, some other text's lines; `-diff`, no line.
const FORMAT = ["--no-ext-diff", "--no-textconv", "--text", "--no-color", "--src-prefix=a/", "--dst-prefix=b/"];

export function diffOf(base, head = "HEAD", opts = {}) {
  const argv = ["diff", `-U${CONTEXT}`, ...FORMAT, `${base}...${head}`, "--", "*.mjs", "*.js", "*.ts", "*.tsx"];
  return execFileSync("git", argv, {
    ...opts,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const over = budget(diffOf(process.argv[2] ?? "origin/main"));
  for (const [file, n] of over) {
    console.error(`comment-budget: ${file} adds ${n.comment} comment lines to ${n.code} of code`);
  }
  if (over.length) {
    console.error("CLAUDE.md: a change adding more comment lines than code is explaining itself.");
    process.exit(1);
  }
  console.log("comment-budget: within budget");
}
