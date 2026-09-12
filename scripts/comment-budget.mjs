/**
 * CLAUDE.md: "A change adding more comment lines than code lines is explaining itself instead of
 * being clear." That rule was in context for every change this repo has ever seen, and it is broken
 * regularly — so it is a check rather than a sentence.
 *
 * Compares each changed file's comment and code counts before and after. Not a diff: "is this line
 * a comment" is a property of the file, and a unified diff is a lossy window over pairs of files
 * rendered through the caller's git configuration — `diff.external`, `color.ui`, `textconv`,
 * `diff.noprefix` and a `.gitattributes` `-diff` marker each change what arrives. `git show
 * <rev>:<path>` and `readFileSync` both return bytes, so none of that surface exists here, and a
 * comment moved between two files nets to zero across the pair without being tracked.
 *
 * Usage: node scripts/comment-budget.mjs [base]   (default origin/main)
 *        exit 0 - within budget; exit 1 - names the files over it
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const git = (...args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    // Piped, not inherited: `show base:added-file` is a normal miss here, and its fatal line on
    // stderr reads as the check having broken.
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });

export function countComments(text) {
  let comment = 0;
  let code = 0;
  let block = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (block) {
      comment += 1;
      if (line.includes("*/")) block = false;
      continue;
    }
    if (line.startsWith("//")) {
      comment += 1;
      continue;
    }
    if (line.startsWith("/*")) {
      comment += 1;
      block = !line.includes("*/", 2);
      continue;
    }
    code += 1;
  }
  return { comment, code };
}

/** A handful of comments on a small change is not a ratio worth policing. */
const FLOOR = 6;

export function over(before, after) {
  const comment = after.comment - before.comment;
  // Against how much code the change *moved*, not its net: code deleted is code moved, and a
  // rewrite that takes 122 lines out is not a change explaining itself. Compared against the net,
  // any file that shrinks puts the bar below zero and every comment over the floor fails it.
  // `abs` rather than a floor of zero, which would pass 50 comment lines beside one deletion.
  return comment > FLOOR && comment > Math.abs(after.code - before.code);
}

const show = (rev, file) => {
  try {
    return git("show", `${rev}:${file}`);
  } catch {
    return ""; // added in this branch
  }
};

export function budget(base, head = "HEAD") {
  const files = git("diff", "--name-only", "--diff-filter=AMR", "-M", `${base}...${head}`,
    "--", "*.mjs", "*.js", "*.ts", "*.tsx").split("\n").filter(Boolean);
  const named = [];
  for (const file of files) {
    const before = countComments(show(base, file));
    let after;
    try {
      after = countComments(readFileSync(file, "utf8"));
    } catch {
      continue; // deleted or renamed away; nothing was written
    }
    if (over(before, after)) {
      named.push([file, { comment: after.comment - before.comment, code: after.code - before.code }]);
    }
  }
  return named;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const named = budget(process.argv[2] ?? "origin/main");
  for (const [file, n] of named) {
    console.error(`comment-budget: ${file} adds ${n.comment} comment lines to ${n.code} of code`);
  }
  if (named.length) {
    console.error("CLAUDE.md: a change adding more comment lines than code is explaining itself.");
    process.exit(1);
  }
  console.log("comment-budget: within budget");
}
