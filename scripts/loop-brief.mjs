/**
 * Re-reads the loop's state into a session that just lost its memory of it.
 *
 * `SessionStart` fires on compact, resume and startup, and this is what stands between an
 * auto-compaction and a restarted ticket. It has to run on whatever shell the host picks: the
 * POSIX one-liner it replaces (`[ -f ... ] && grep -q ... && cat`) is not a command under
 * PowerShell, which rejects it at parse time — a hook that does nothing while reporting success.
 *
 * So: node, no shell operators, no environment expansion, and the state found through git rather
 * than through the working directory the host happened to choose.
 *
 * Silent unless a run is live, and never non-zero — a broken brief must not take the session down.
 */
import { readState, readLessons, readFields, isRunning } from "./loop-state.mjs";

/** @param {string} state @param {string} lessons @returns {string} */
export function brief(state, lessons) {
  if (!isRunning(readFields(state))) return "";
  return [
    "An autonomous ticket run is live. Resume at the phase below — do not re-plan, do not",
    "restart the ticket, do not ask whether to continue. `.claude/commands/queue.md` is the",
    "procedure; an empty line under Evidence means that phase did not finish.",
    "",
    state.trimEnd(),
    lessons.trim() ? `\n${lessons.trimEnd()}` : "",
  ].join("\n");
}

try {
  const out = brief(readState(), readLessons());
  if (out) console.log(out);
} catch {
  /* no git, no repo, no state: nothing to restore and nothing to say about it */
}
