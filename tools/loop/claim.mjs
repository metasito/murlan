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
 * The steps. `worktree` is last because it is the mutex: `.worktrees/agent-<n>` is one directory and
 * `git worktree add` refuses a second claim on it atomically, which a comment-reading race check
 * cannot do — the slug is derived from the title now, so a real peer writes the *same* branch name
 * and reads as us, while a dead run's model-chosen slug reads as a peer. #1043 was parked by that.
 */
export function claimSteps(number, title, noteFile = "", base = "origin/main") {
  const branch = `agent/${number}-${slugOf(title)}`;
  return [
    { name: "label", file: "gh", args: ["issue", "edit", String(number), "--add-label", "in-progress"] },
    { name: "comment", file: "gh", args: ["issue", "comment", String(number), "--body-file", noteFile] },
    { name: "fetch", file: "git", args: ["fetch", "origin", "--quiet"] },
    {
      name: "worktree",
      file: "git",
      // `-B` off the branch's own remote, never off main: a ticket whose supervisor died between CI
      // rounds already has that branch, and cutting a fresh one discards what it pushed.
      args: [
        "worktree",
        "add",
        base === "origin/main" ? "-b" : "-B",
        branch,
        `${WORKTREE_DIR}/agent-${number}`,
        base,
      ],
    },
  ];
}

/** git's two ways of saying the directory is spoken for. Its other failures are not this one. */
const taken = (err, cwd) => {
  const said = String(err?.message ?? err);
  return said.includes("already used by worktree") || (said.includes(cwd) && said.includes("already exists"));
};

/** Whether the branch is already pushed — asked after the fetch, so the answer is current. */
function onOrigin(branch, run) {
  try {
    run("git", ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

export function claim(number, title, run = (file, args) => execFileSync(file, args, { encoding: "utf8" })) {
  const branch = `agent/${number}-${slugOf(title)}`;
  const cwd = `${WORKTREE_DIR}/agent-${number}`;
  const noteFile = join(mkdtempSync(join(tmpdir(), "claim-")), "claim.md");
  writeFileSync(noteFile, `Claimed by \`${branch}\`.\n`, "utf8");

  for (const step of claimSteps(number, title, noteFile)) {
    const args =
      step.name === "worktree" && onOrigin(branch, run)
        ? claimSteps(number, title, noteFile, `origin/${branch}`).at(-1).args
        : step.args;
    try {
      run(step.file, args);
    } catch (err) {
      // Only the path being taken means a peer holds this ticket. A stale local branch is a
      // different failure, and reporting it as a peer leaves `in-progress` on for ever.
      if (step.name !== "worktree" || !taken(err, cwd)) throw err;
      return { branch, cwd, won: false, why: `${cwd} is already standing` };
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
