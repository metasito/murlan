/**
 * CLAUDE.md: "A change adding more comment lines than code lines is explaining itself instead of
 * being clear." That rule was in context for every change this repo has ever seen, and it is broken
 * regularly — so it is a check rather than a sentence.
 *
 * Counts the lines a change *adds*, comment against code. "Is this line a comment" is a property
 * of the whole file — block state has no hunk window to fall out of — so both revisions are read
 * as bytes (`git show <rev>:<path>`, `readFileSync`) and the added lines are found here rather
 * than parsed out of a rendered diff, which `diff.external`, `color.ui`, `textconv`,
 * `diff.noprefix` and a `.gitattributes` `-diff` marker each reshape under the caller.
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

function* classify(text) {
  let block = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (block) {
      yield [line, true];
      if (line.includes("*/")) block = false;
      continue;
    }
    if (line.startsWith("//")) {
      yield [line, true];
      continue;
    }
    if (line.startsWith("/*")) {
      yield [line, true];
      block = !line.includes("*/", 2);
      continue;
    }
    yield [line, false];
  }
}

/**
 * The lines `after` holds that `before` did not, by multiset: every trimmed line of `before` is a
 * token one line of `after` may spend. Order is ignored on purpose, so a block moved within a file
 * or merely reindented is not "added" — the rule is about prose that is new, not prose that moved.
 */
export function addedCounts(before, after) {
  const pool = new Map();
  for (const [line] of classify(before)) pool.set(line, (pool.get(line) ?? 0) + 1);
  let comment = 0;
  let code = 0;
  for (const [line, isComment] of classify(after)) {
    const held = pool.get(line) ?? 0;
    if (held) {
      pool.set(line, held - 1);
      continue;
    }
    if (isComment) comment += 1;
    else code += 1;
  }
  return { comment, code };
}

/** A handful of comments on a small change is not a ratio worth policing. */
const FLOOR = 6;

export function over(added) {
  return added.comment > FLOOR && added.comment > added.code;
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
    let after;
    try {
      after = readFileSync(file, "utf8");
    } catch {
      continue; // deleted or renamed away; nothing was written
    }
    const added = addedCounts(show(base, file), after);
    if (over(added)) named.push([file, added]);
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
