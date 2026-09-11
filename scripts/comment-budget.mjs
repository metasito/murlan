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

export function budget(diff) {
  const files = new Map();
  const lines = diff.split("\n");

  // A comment line the diff also deletes somewhere is prose that moved, not prose
  // that was written: an extraction carries a function's docstring to its new file,
  // and counting that as explanation would price documenting a small function out of
  // ever being moved. Matched on the exact text, and each deletion pays for one
  // addition, so no amount of new prose can hide behind it. Credit is minted only
  // where it is spent — a file this check counts — or a deleted markdown bullet
  // would fund a docstring.
  const moved = new Map();
  let from = null;
  for (const line of lines) {
    if (line.startsWith("--- ")) {
      const named = /^--- a\/(.+)$/.exec(line);
      from = named && CODE.test(named[1]) ? named[1] : null;
      continue;
    }
    if (!from || !line.startsWith("-") || !LINE.test("+" + line.slice(1))) continue;
    const text = line.slice(1).trim();
    moved.set(text, (moved.get(text) ?? 0) + 1);
  }

  let file = null;
  for (const line of lines) {
    const named = /^\+\+\+ b\/(.+)$/.exec(line);
    if (named) {
      file = CODE.test(named[1]) ? named[1] : null;
      if (file && !files.has(file)) files.set(file, { comment: 0, code: 0 });
      continue;
    }
    if (!file || !line.startsWith("+") || line.startsWith("+++")) continue;
    const at = files.get(file);
    if (LINE.test(line)) {
      const left = moved.get(line.slice(1).trim()) ?? 0;
      if (left) moved.set(line.slice(1).trim(), left - 1);
      else at.comment += 1;
    } else if (line.slice(1).trim()) at.code += 1;
  }
  // A handful of comments on a small change is not a ratio worth policing; the rule is about a diff
  // that is mostly prose.
  return [...files].filter(([, n]) => n.comment > 6 && n.comment > n.code);
}

export function diffOf(base, head = "HEAD") {
  return execFileSync("git", ["diff", `${base}...${head}`, "--", "*.mjs", "*.js", "*.ts", "*.tsx"], {
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
