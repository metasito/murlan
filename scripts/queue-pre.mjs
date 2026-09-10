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

// `--stale` takes only what is orphaned *and* old, so it cannot reach a peer session's live run.
const STEPS = [
  ["prune-worktrees", ["scripts/prune-worktrees.mjs"]],
  ["preflight", ["scripts/preflight.mjs"]],
  ["reap", ["scripts/reap.mjs", "--stale"]],
];

export function main(run = spawnSync, log = console.error) {
  for (const [name, args] of STEPS) {
    const { status } = run(process.execPath, args, { stdio: "inherit" });
    if (status !== 0) {
      log(`queue-pre: ${name} refused (exit ${status}) — not starting a ticket on top of it`);
      return status ?? 1;
    }
  }
  return 0;
}

if (process.argv[1]?.endsWith("queue-pre.mjs")) process.exit(main());
