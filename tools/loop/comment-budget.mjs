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
 * Usage: node tools/loop/comment-budget.mjs [base]   (default origin/main)
 *        exit 0 - within budget; exit 1 - names the files over it
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";

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

const key = (line, isComment) => `${isComment ? "c" : "k"}${line}`;

/**
 * By multiset, not by alignment: each line of `before` is a token one line of `after` may spend,
 * so a line counts as added only when that text, at that kind, was not in the file already. The
 * kind is in the key on purpose — a line that stops being code and starts being prose is prose
 * the change wrote, and the budget is about how much prose a reader now has to get past.
 *
 * This is not a line diff and neither bounds the other, in either column. The tests are what say
 * what it does; do not reason from the two being close.
 */
export function addedCounts(before, after) {
  const pool = new Map();
  for (const [line, isComment] of classify(before)) {
    const k = key(line, isComment);
    pool.set(k, (pool.get(k) ?? 0) + 1);
  }
  let comment = 0;
  let code = 0;
  for (const [line, isComment] of classify(after)) {
    const k = key(line, isComment);
    const held = pool.get(k) ?? 0;
    if (held) {
      pool.set(k, held - 1);
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

export function budget(base) {
  // One revision on the far side and the working tree on this one, for both the file list and the
  // content. Reading content at `base`'s tip while listing files against the merge base would
  // charge the branch for whatever main removes meanwhile. `quotePath` off, or a path with a
  // non-ASCII byte arrives escaped and in quotes. `--no-relative` plus the root makes both halves
  // agree from any cwd: git's own default is relative to the caller's directory only sometimes.
  const from = git("merge-base", base, "HEAD").trim();
  const root = git("rev-parse", "--show-toplevel").trim();
  const files = git("-c", "core.quotePath=false", "diff", "--name-only", "--no-relative",
    "--diff-filter=AMR", "-M", from, "--", "*.mjs", "*.js", "*.ts", "*.tsx")
    .split("\n").filter(Boolean);
  const named = [];
  for (const file of files) {
    // No skip on a read failure: `AMR` never emits a deletion and `-M` emits a rename's
    // destination, so every path here exists. A swallowed read is a check that passes by not
    // looking at the one file it could not open.
    const added = addedCounts(show(from, file), readFileSync(join(root, file), "utf8"));
    if (over(added)) named.push([file, added]);
  }
  return named;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
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
