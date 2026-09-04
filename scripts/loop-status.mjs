/**
 * Where the run stands, for a session that has just lost its memory of it.
 *
 * `SessionStart` fires on compact, resume and startup, and this is what stands between an
 * auto-compaction and a restarted ticket. It replaces a state file that was read back verbatim:
 * everything here is derived from git and the tracker, so it cannot describe a run that is not
 * happening, and cannot miss one that is.
 *
 * Silent off a ticket branch, and never non-zero — a broken brief must not take the session down.
 */
import { derive } from "./loop-derive.mjs";

export function report(s) {
  if (!s.onTicket) return "";
  const next = {
    C: "C — Build. Commit each slice as you finish it.",
    D: "D — Review. A fresh subagent reads the diff; post its verdict on the issue.",
    E: "E — Land. Run the gate, then the check, then push.",
    "?": "unclear — read the error above before doing anything.",
  }[s.phase];
  return [
    `An autonomous ticket run is live: #${s.ticket} on \`${s.branch}\`.`,
    "Resume where it says. Do not re-plan, do not restart the ticket, do not ask whether to",
    "continue. `.claude/commands/queue.md` is the procedure.",
    "",
    `  commits    ${s.commits ?? "?"} against origin/main, ${s.changed?.length ?? "?"} file(s)`,
    `  review     ${s.verdict ? s.verdict.line : `none for ${s.head?.slice(0, 7) ?? "this head"}`}`,
    `  resume at  ${next}`,
    "",
    `Because: ${s.why}. Uncommitted changes in the worktree are your in-progress slice — finish`,
    "it, do not start over.",
  ].join("\n");
}

try {
  const out = report(derive());
  if (out) console.log(out);
} catch {
  /* no git, no repo, nothing to restore and nothing to say about it */
}
