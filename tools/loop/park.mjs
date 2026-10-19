/**
 * The park: the one operation that reaches both the worktree (its commit and its removal) and the
 * tracker (its label and note), so it sits above `workspace.mjs` and `tracker.mjs` alike.
 */
import path from "node:path";
import { DIR, errorLine, parkNotePath, writeNote } from "./loop-logs.mjs";
import { ROOT } from "./paths.mjs";
import { ghTracker, PARK_STEPS } from "./tracker.mjs";
import { sh, tearDown } from "./workspace.mjs";

/**
 * Hands a ticket back to the owner: the work committed, the claim released, the reason on the
 * issue, the worktree gone.
 *
 * Each step reports rather than throwing. This is the failure path — reached from the stop-file
 * drain as well as from a bad session — so a throw here would turn an orderly stop into an
 * unhandled rejection.
 *
 * @param {number} number
 * @param {{phase: string, why: string, log: string, cwd: string|null, branch: string|null,
 *   dirty: boolean, error?: object|null, run?: Function, tracker?: object, write?: Function, root?: string, remove?: Function}} ctx
 * @returns {{ok: boolean, failed: string[]}}
 */
export function park(
  number,
  {
    phase,
    why,
    log,
    cwd,
    branch,
    dirty,
    error = null,
    run = sh,
    tracker = ghTracker((args, opts) => run("gh", args, opts)),
    write = writeNote,
    root = ROOT,
    remove = (tree) => tearDown(tree, { git: (args) => run("git", args, { cwd: root }) }),
  },
) {
  const logs = path.join(root, DIR);
  const failed = [];
  const step = (name, fn) => {
    try {
      fn();
    } catch (err) {
      failed.push(name);
      console.error(`  ⚠️ park #${number}: ${name} failed — ${String(err.message).split("\n")[0]}`);
    }
  };

  if (dirty && cwd) {
    // `-A` is safe here and nowhere else: this is the ticket's own worktree, which has its own
    // index, and rule 40 keeps every other session out of it. Losing an unstaged edit is the one
    // thing parking must not do. Re-read rather than trusting `dirty`: it comes from a derive()
    // up to twenty seconds old, and a session that committed in that window leaves nothing to
    // stage, which makes `git commit` exit 1.
    step("commit", () => {
      run("git", ["-C", cwd, "add", "-A", "--", "."]);
      if (run("git", ["-C", cwd, "status", "--porcelain"]).trim()) {
        run("git", ["-C", cwd, "commit", "-m", `wip(#${number}): parked in phase ${phase}`]);
      }
    });
  }

  step("label", () => PARK_STEPS.label(number, tracker));

  const body = [
    `Parked by the queue loop in **phase ${phase}**.`,
    "",
    `- reason: ${why}`,
    `- branch: \`${branch ?? "none"}\`${dirty ? " (uncommitted work was committed before teardown)" : ""}`,
    `- log: \`${log}\``,
    ...(error ? [`- error: ${errorLine(error)}`] : []),
    ...(error?.stderr ? ["", "```", error.stderr, "```"] : []),
    "",
    "The branch keeps its commits. Nothing was discarded.",
    "",
    "**To send it back:** deal with the reason above, then swap `ready-for-human` for `ready-for-agent`." +
      " The next run resumes from the branch as it stands.",
  ].join("\n");
  step("comment", () => {
    write(parkNotePath(number, logs), body);
    PARK_STEPS.comment(number, tracker, logs);
  });

  if (cwd) step("worktree", () => remove(cwd));

  return { ok: failed.length === 0, failed };
}
