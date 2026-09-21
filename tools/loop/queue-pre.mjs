/**
 * What has to be true before a ticket starts, in one command.
 *
 * These are loop-level, not ticket-level: a killed run's leftover worktree, a peer's uncommitted
 * work in the shared checkout, an overnight run's orphaned processes. `queue-loop.mjs` runs this
 * before every spawn, so a ticket's own context never carries the housekeeping.
 *
 * Every check answers in one shape, so `main` has a single loop and a single place deciding how a
 * result reads. Three of them spawn a sibling script and two do not; from here that is no
 * difference.
 *
 * Usage: npm run queue:pre
 *        exit 0 - clear to start; exit non-zero - names the step that refused
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { AGENT_DIR, FOUND_NOTHING, IF_FOUND, REPO, WORKTREE_DIR } from "./loop-derive.mjs";
import { checkMain } from "./mainHealth.ts";
import { clip } from "./agent-check.mjs";
import { capabilities, note, stepRow, theme } from "./loop-render.mjs";

/**
 * @typedef {null | {
 *   state: "done"|"warned"|"failed", detail?: string, note?: string, stop?: number
 * }} Result what a check found, or `null` for nothing worth saying. `detail` is the row's one
 *   line, `note` the words folded behind it, `stop` an exit code that refuses the ticket. The
 *   label belongs to the list, not the check.
 *
 * @typedef {(() => Result) & { args?: string[] }} Check_run the check itself; `args` is what it
 *   spawns, present only on the ones that spawn something.
 *
 * @typedef {{ label: string, run: Check_run }} Check
 */

// A sibling is found by this file's own directory, not the cwd: nothing guarantees the supervisor
// runs from the repo root.
const HERE = import.meta.dirname;

const SPEAKERS = /^(?:worktrees|prune-worktrees|preflight|reap|queue-pre):\s*/i;

/**
 * A step's last line, which is the one it writes once it knows how it went.
 *
 * Its own name is stripped from the front, since the row already carries it. Only a prefix naming
 * one of these scripts — never a colon inside the sentence, which is every Windows path and every
 * clock time they print.
 */
export function summarise(stdout) {
  const last = String(stdout ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .at(-1);
  return last ? last.replace(SPEAKERS, "") : "";
}

/** @returns {Check_run} a check that runs a sibling script and reports what it said. */
export function script(args, run = spawnSync) {
  const check = () => {
    const { status, stdout, stderr } = run(process.execPath, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Nothing found, so nothing to print — `main`'s `if (!result) continue` is what suppresses the
    // row, the same machinery `redMain` has always used. A warning it chose to raise still earns
    // one. Read only when this call asked for the answer, so an unrelated exit 4 stays a refusal.
    if (status === FOUND_NOTHING && args.includes(IF_FOUND)) {
      return stderr?.trim() ? { state: "warned", detail: summarise(stdout), note: stderr } : null;
    }
    if (status !== 0) {
      // A spawn that never started answers with a null status, which is not a pass.
      return {
        state: "failed",
        detail: `refused (exit ${status}) — not starting a ticket`,
        note: clip([stdout, stderr].filter(Boolean).join("\n")),
        stop: status ?? 1,
      };
    }
    // Anything on stderr from a clean exit is a warning the step chose to raise, so it is shown;
    // the routine account on stdout stays folded behind the row.
    return { state: stderr?.trim() ? "warned" : "done", detail: summarise(stdout), note: stderr };
  };
  check.args = args;
  return check;
}

/**
 * `derive()` reads a worktree's *branch* to find the ticket and ignores a directory whose branch
 * is not `agent/<n>-…`; `prune-worktrees` reads the *registration* and treats every directory
 * under `.worktrees/` as first class. A `fix-971` is therefore invisible to the thing that decides
 * whether a run is live and visible to the thing that deletes worktrees.
 */
export function misnamedWorktrees(dirs) {
  return dirs.filter((d) => !AGENT_DIR.test(d.split(/[\\/]/).pop() ?? ""));
}

/** Directories only: a session's scratch file there is not a worktree, and refusing it halted a run. */
export const worktreeDirs = (dir = WORKTREE_DIR) =>
  existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];

/** @returns {Result} */
export function namedWorktrees(dirs = worktreeDirs()) {
  const bad = misnamedWorktrees(dirs);
  if (bad.length === 0) return null;
  return {
    state: "failed",
    detail: `${bad.length} not made by the loop — remove to start`,
    note: bad
      .map((n) => `${WORKTREE_DIR}/${n}\n  npm run worktrees:remove -- ${WORKTREE_DIR}/${n}`)
      .join("\n"),
    stop: 1,
  };
}

const ghCli = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 1 << 24 });

/**
 * A red `main` is a reason to file a ticket, never a reason to refuse one.
 *
 * `mainHealth.ts` decides and files; this is only how it reads. Green and every inconclusive
 * answer — a run still going, a cancelled one, a runner that never started, an unreachable API —
 * earn no row.
 *
 * @returns {Result}
 */
export function redMain(gh = ghCli) {
  const health = checkMain({ repo: REPO, gh });
  if (health.state !== "filed") return null;
  return {
    state: "warned",
    detail: `red — ${health.why}`,
    note: `A ticket cut from here inherits it. Read the run before blaming the diff.\n${health.url ?? health.title}`,
  };
}

/**
 * The order is load-bearing: the prune has to have run before the naming check reads what is left,
 * or it refuses over a directory that was about to go.
 *
 * `--stale` takes only what is orphaned *and* old, so `reap` cannot reach a peer's live run.
 *
 * @type {Check[]}
 */
export const CHECKS = [
  { label: "worktrees", run: script([HERE + "/prune-worktrees.mjs", IF_FOUND]) },
  { label: "preflight", run: script([HERE + "/preflight.mjs", IF_FOUND]) },
  { label: "reap", run: script([HERE + "/reap.mjs", "--stale", IF_FOUND]) },
  { label: "worktrees", run: namedWorktrees },
  { label: "main", run: redMain },
];

/** One row per check; its own words only when they are worth reading. */
function report({ note: words = "", ...step }) {
  const t = theme(capabilities(process.stderr));
  process.stderr.write(`${stepRow(step, t)}\n`);
  if (words.trim()) process.stderr.write(`${note(words, t)}\n`);
}

export function main(say = report, checks = CHECKS) {
  for (const { label, run } of checks) {
    const at = Date.now();
    const result = run();
    if (!result) continue;
    say({ label, ms: Date.now() - at, ...result });
    if (result.stop !== undefined) return result.stop;
  }
  return 0;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) process.exit(main());
