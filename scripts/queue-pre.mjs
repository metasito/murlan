/**
 * What has to be true before a ticket starts, in one command.
 *
 * These are loop-level, not ticket-level: a killed run's leftover worktree, a peer's uncommitted
 * work in the shared checkout, an overnight run's orphaned processes. `queue-loop.mjs` runs this
 * before every spawn, so a ticket's own context never carries three tool calls' worth of
 * housekeeping — and a by-hand `/queue` runs it too, which is why it is one named command rather
 * than three the model has to remember in order.
 *
 * Usage: npm run queue:pre
 *        exit 0 - clear to start; exit non-zero - names the step that refused
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";

// `--stale` takes only what is orphaned *and* old, so it cannot reach a peer session's live run.
const STEPS = [
  ["prune-worktrees", ["scripts/prune-worktrees.mjs"]],
  ["preflight", ["scripts/preflight.mjs"]],
  ["reap", ["scripts/reap.mjs", "--stale"]],
];

const WORKTREE_DIR = ".worktrees";

/**
 * `derive()` reads a worktree's *branch* to find the ticket and ignores a directory whose branch
 * is not `agent/<n>-…`; `prune-worktrees` reads the *registration* and treats every directory
 * under `.worktrees/` as first class. A `fix-971` is therefore invisible to the thing that decides
 * whether a run is live and visible to the thing that deletes worktrees.
 */
export function misnamedWorktrees(dirs) {
  return dirs.filter((d) => !/^agent-\d+$/.test(d.split(/[\\/]/).pop() ?? ""));
}

/** A red `main` is not a reason to refuse a ticket, and it is a reason to say so before one starts. */
export function mainHealth(run = spawnSync, log = console.error) {
  let last;
  try {
    const { stdout, status } = run(
      "gh",
      ["run", "list", "--branch", "main", "--limit", "1", "--json", "conclusion,headSha,url"],
      { encoding: "utf8" },
    );
    if (status !== 0) return;
    [last] = JSON.parse(stdout || "[]");
  } catch {
    return;
  }
  if (!last?.conclusion || last.conclusion === "success") return;
  log(`queue-pre: main's last run was ${last.conclusion} at ${last.headSha?.slice(0, 8)} — ${last.url}`);
  log("  A ticket cut from here inherits it. Read the run before blaming the diff.");
}

export function main(run = spawnSync, log = console.error) {
  for (const [name, args] of STEPS) {
    const { status } = run(process.execPath, args, { stdio: "inherit" });
    if (status !== 0) {
      log(`queue-pre: ${name} refused (exit ${status}) — not starting a ticket on top of it`);
      return status ?? 1;
    }
  }

  if (existsSync(WORKTREE_DIR)) {
    const bad = misnamedWorktrees(readdirSync(WORKTREE_DIR));
    if (bad.length > 0) {
      for (const name of bad) {
        log(`queue-pre: ${WORKTREE_DIR}/${name} is not an agent-<n> worktree, so derive() cannot see it`);
        log(`  npm run worktrees:remove -- ${WORKTREE_DIR}/${name}`);
      }
      return 1;
    }
  }

  mainHealth();
  return 0;
}

if (process.argv[1]?.endsWith("queue-pre.mjs")) process.exit(main());
