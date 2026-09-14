/**
 * Claims a ticket and stands its worktree up, as one subprocess.
 *
 * Six `gh` and `git` calls that need no judgement were six model turns of phase A, each paying a
 * full context read; and the claim comment's backticks are what `next-ticket.mjs` matches a peer's
 * claim on, which PowerShell turns into a BEL when a model writes it inline.
 *
 * Usage: node tools/loop/claim.mjs <n> "<title>"
 *        exit 0 - claimed, worktree standing; exit 1 - lost the race, or could not
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WORKTREE_DIR } from "./loop-derive.mjs";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";

const SLUG_MAX = 48;

export function slugOf(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-$/, "");
}

/**
 * The steps, in the one order that makes the race check mean anything: the label is the write, and
 * the read that decides who won has to come after it.
 */
export function claimSteps(number, title, noteFile = "") {
  const branch = `agent/${number}-${slugOf(title)}`;
  return [
    { name: "label", file: "gh", args: ["issue", "edit", String(number), "--add-label", "in-progress"] },
    { name: "comment", file: "gh", args: ["issue", "comment", String(number), "--body-file", noteFile] },
    { name: "race", file: "gh", args: ["issue", "view", String(number), "--json", "comments"] },
    { name: "fetch", file: "git", args: ["fetch", "origin", "--quiet"] },
    {
      name: "worktree",
      file: "git",
      args: ["worktree", "add", "-b", branch, `${WORKTREE_DIR}/agent-${number}`, "origin/main"],
    },
  ];
}

/** Every claim comment on the thread, by the branch it names. A fresh one per read: `g` is stateful. */
const claims = () => /Claimed by `(agent\/\d+-[^`]*)`/g;

export function claim(number, title, run = (file, args) => execFileSync(file, args, { encoding: "utf8" })) {
  const branch = `agent/${number}-${slugOf(title)}`;
  const cwd = `${WORKTREE_DIR}/agent-${number}`;
  const noteFile = join(mkdtempSync(join(tmpdir(), "claim-")), "claim.md");
  writeFileSync(noteFile, `Claimed by \`${branch}\`.\n`, "utf8");

  for (const step of claimSteps(number, title, noteFile)) {
    const out = run(step.file, step.args);
    if (step.name !== "race") continue;
    const others = [...String(out).matchAll(claims())].map((m) => m[1]).filter((b) => b !== branch);
    if (others.length) {
      run("gh", ["issue", "edit", String(number), "--remove-label", "in-progress"]);
      return { branch, cwd, won: false, why: `${others[0]} claimed it first` };
    }
  }
  return { branch, cwd, won: true, why: null };
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const [n, title] = process.argv.slice(2);
  const out = claim(Number(n), title ?? `ticket ${n}`);
  console.log(`CLAIM\t${out.won ? "won" : "lost"}\t${out.branch}\t${out.cwd}\t${out.why ?? ""}`);
  process.exit(out.won ? 0 : 1);
}
