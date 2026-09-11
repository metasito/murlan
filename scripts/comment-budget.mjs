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
const LINE = /^\s*(\/\/|\*|\/\*)/;
// Scaffolding carrying no words. Neither charged nor creditable: charging it would fail a file
// split for punctuation, and crediting it would let one deleted block excuse the frame of a new one.
const BARE = /^\s*(\/\*\*?|\*\/|\*|\/\/)\s*$/;

const prose = (body) => LINE.test(body) && !BARE.test(body);

/**
 * One credit per comment line deleted anywhere in the diff. A file split moves prose verbatim, and
 * git's rename detection cannot see it: it consumes the source as one file's rename and will not
 * also report it as the others' copy source, so the exemption has to be content, not history.
 *
 * Credit is spent, never minted: nothing is excused that was not deleted somewhere in the diff.
 */
function movedCredits(diff) {
  const credits = new Map();
  for (const line of diff.split("\n")) {
    if (!line.startsWith("-") || line.startsWith("---")) continue;
    const body = line.slice(1);
    if (prose(body)) credits.set(body, (credits.get(body) ?? 0) + 1);
  }
  return credits;
}

export function budget(diff) {
  const files = new Map();
  const credits = movedCredits(diff);
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
    const body = line.slice(1);
    // An exact match only: a line reworded on the way is prose someone wrote today.
    if (prose(body)) {
      const left = credits.get(body) ?? 0;
      if (left) credits.set(body, left - 1);
      else at.comment += 1;
    } else if (!LINE.test(body) && body.trim()) at.code += 1;
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
