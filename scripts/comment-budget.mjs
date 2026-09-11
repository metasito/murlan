/**
 * CLAUDE.md: "A change adding more comment lines than code lines is explaining itself instead of
 * being clear." That rule was in context for every change this repo has ever seen, and it is broken
 * regularly — so it is a check rather than a sentence.
 *
 * Counts only added lines, against a base. Deletions are free: taking comments out is always fine.
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
  let file = null;
  for (const line of diff.split("\n")) {
    const named = /^\+\+\+ b\/(.+)$/.exec(line);
    if (named) {
      file = CODE.test(named[1]) ? named[1] : null;
      if (file && !files.has(file)) files.set(file, { comment: 0, code: 0 });
      continue;
    }
    if (!file || !line.startsWith("+") || line.startsWith("+++")) continue;
    const at = files.get(file);
    if (LINE.test(line)) at.comment += 1;
    else if (line.slice(1).trim()) at.code += 1;
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
