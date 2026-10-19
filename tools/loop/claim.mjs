/**
 * Claims a ticket and stands its worktree up, as one subprocess: the claim comment's backticks are
 * what `next-ticket.mjs` matches a peer's claim on, and PowerShell turns them into a BEL when a
 * model writes the comment inline.
 *
 * Usage: node tools/loop/claim.mjs <n> "<title>"
 *        exit 0 - claimed, worktree standing; exit 1 - lost the race, or could not
 */
import { gh, git } from "./cli.mjs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WORKTREE_DIR } from "./loop-derive.mjs";
import { ghTracker } from "./tracker.mjs";
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

export const branchOf = (number, title) => `agent/${number}-${slugOf(title)}`;

/**
 * `worktree` is last because it is the mutex: `git worktree add` refuses a second claim on
 * `.worktrees/agent-<n>` atomically. A comment-reading race check cannot: a real peer writes the
 * same title-derived branch name and reads as us.
 */
export function claimSteps(number, title, noteFile = "", base = "origin/main") {
  const branch = branchOf(number, title);
  const cwd = `${WORKTREE_DIR}/agent-${number}`;
  return [
    { name: "label", tracker: (t) => t.claim(number) },
    { name: "comment", tracker: (t) => t.comment(number, noteFile) },
    { name: "fetch", file: "git", args: ["fetch", "origin", "--prune", "--quiet"] },
    {
      name: "worktree",
      file: "git",
      // `-B` off the branch's own remote, never off main: a ticket whose supervisor died between CI
      // rounds already has that branch, and cutting a fresh one discards what it pushed. A branch
      // only this machine holds — a run parked before it pushed — is checked out as it stands.
      args:
        base === branch
          ? ["worktree", "add", cwd, branch]
          : ["worktree", "add", base === "origin/main" ? "-b" : "-B", branch, cwd, base],
    },
  ];
}

/**
 * git's two ways of saying the directory is spoken for. Read from git's own stderr: node's
 * `message` opens with the command line, which names the path.
 */
const taken = (err, cwd) => {
  const said = String(err?.stderr ?? "");
  return said.includes("already used by worktree") || (said.includes(cwd) && said.includes("already exists"));
};

const succeeds = (args, run) => {
  try {
    run("git", args);
    return true;
  } catch {
    return false;
  }
};

/**
 * Where the worktree starts — asked after the fetch, so the answer is current. Whichever of the
 * local and pushed branch holds the other's commits; one ahead of origin is never reset to it.
 */
const localOnly = (upstream, branch, run) =>
  String(run("git", ["cherry", upstream, branch])).split("\n").flatMap((l) => (l.startsWith("+ ") ? [l.slice(2).trim()] : []));

/** Applying `sha` onto `upstream` changes nothing: the same edit under another patch-id. */
const appliesEmpty = (sha, upstream, run) => {
  try {
    const tree = String(run("git", ["merge-tree", "--write-tree", "--merge-base", `${sha}^`, upstream, sha])).split("\n")[0].trim();
    return tree === String(run("git", ["rev-parse", `${upstream}^{tree}`])).trim();
  } catch {
    return false;
  }
};

/** Every patch only the local branch has is already on origin's branch or on main. */
function onlyUpstream(branch, run) {
  const upstreams = [`origin/${branch}`, "origin/main"];
  const onMain = new Set(localOnly("origin/main", branch, run));
  return localOnly(`origin/${branch}`, branch, run).every((sha) => !onMain.has(sha) || upstreams.some((u) => appliesEmpty(sha, u, run)));
}

export function baseOf(branch, run) {
  const remote = succeeds(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`], run);
  const local = succeeds(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], run);
  if (!remote) return local ? branch : "origin/main";
  if (!local || succeeds(["merge-base", "--is-ancestor", branch, `origin/${branch}`], run)) return `origin/${branch}`;
  if (succeeds(["merge-base", "--is-ancestor", `origin/${branch}`, branch], run)) return branch;
  // The stale local branch a rebase and force-push leave behind: `git worktree add -B` refuses a
  // branch a worktree holds, so resetting it loses only patches no upstream already carries.
  if (onlyUpstream(branch, run)) return `origin/${branch}`;
  throw new Error(`${branch} has diverged from origin/${branch}: resetting either side would lose commits`);
}

export function claim(
  number,
  title,
  run = (file, args) => (file === "gh" ? gh(args) : git()(args)),
  tracker = ghTracker((args) => run("gh", args)),
) {
  const branch = branchOf(number, title);
  const cwd = `${WORKTREE_DIR}/agent-${number}`;
  const noteDir = mkdtempSync(join(tmpdir(), "claim-"));
  const noteFile = join(noteDir, "claim.md");
  writeFileSync(noteFile, `Claimed by \`${branch}\`.\n`, "utf8");

  try {
    for (const step of claimSteps(number, title, noteFile)) {
      const args =
        step.name === "worktree" ? claimSteps(number, title, noteFile, baseOf(branch, run)).at(-1).args : step.args;
      try {
        if (step.tracker) step.tracker(tracker);
        else run(step.file, args);
      } catch (err) {
        // Only the path being taken means a peer holds this ticket. A stale local branch is a
        // different failure, and reporting it as a peer leaves `in-progress` on for ever.
        if (step.name !== "worktree" || !taken(err, cwd)) throw err;
        return {
          branch,
          cwd,
          won: false,
          why: `${cwd} is already standing — if no run is working it, \`npm run worktrees:remove -- ${cwd}\``,
        };
      }
    }
    return { branch, cwd, won: true, why: null };
  } finally {
    rmSync(noteDir, { recursive: true, force: true });
  }
}

/** Why a claim threw — git's own words, never a stack. */
export const claimError = (err) => String(err?.stderr || err?.message || err).trim().split("\n").at(-1);

export const failedClaim = (err) => `CLAIM\tfailed\t\t\t${claimError(err)}`;

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const [n, title] = process.argv.slice(2);
  let out;
  try {
    out = claim(Number(n), title ?? `ticket ${n}`);
  } catch (err) {
    console.log(failedClaim(err));
    process.exit(1);
  }
  console.log(`CLAIM\t${out.won ? "won" : "lost"}\t${out.branch}\t${out.cwd}\t${out.why ?? ""}`);
  process.exit(out.won ? 0 : 1);
}
