/**
 * Re-reads the loop's state into a session that just lost its memory of it.
 *
 * `SessionStart` fires on compact, resume and startup, and this is what stands between an
 * auto-compaction and a restarted ticket. It has to run on whatever shell the host picks: the
 * POSIX one-liner it replaces (`[ -f ... ] && grep -q ... && cat`) is not a command under
 * cmd.exe, which greets it with a banner and exits 0 — a hook that does nothing while
 * reporting success, which is worse than no hook at all.
 *
 * So: node, no shell operators, no environment expansion, and paths resolved from this file
 * rather than from the working directory the host happened to choose.
 *
 * Silent unless a run is live, and never non-zero — a broken brief must not take the session
 * with it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const loopDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".claude", "loop");

const read = (name) => {
  try {
    return fs.readFileSync(path.join(loopDir, name), "utf8");
  } catch {
    return "";
  }
};

/**
 * @param {string} state
 * @param {string} lessons
 * @returns {string}
 */
export function brief(state, lessons) {
  if (!/^status: RUNNING\b/m.test(state)) return "";
  return [
    "An autonomous ticket run is live. Resume at the phase below — do not re-plan, do not",
    "restart the ticket, do not ask whether to continue. `.claude/commands/queue.md` is the",
    "procedure; an empty line under Evidence means that phase did not finish.",
    "",
    state.trimEnd(),
    lessons.trim() ? `\n${lessons.trimEnd()}` : "",
  ].join("\n");
}

const out = brief(read("STATE.md"), read("LESSONS.md"));
if (out) console.log(out);
