/**
 * Where the run stands, for a session that has just lost its memory of it.
 *
 * `SessionStart` fires on compact, resume and startup, and this is what stands between an
 * auto-compaction and a restarted ticket. It replaces a state file that was read back verbatim:
 * everything here is derived from git and the tracker, so it cannot describe a run that is not
 * happening, and cannot miss one that is.
 *
 * It runs in the shared checkout, never in the run's worktree — `derive` finds that itself.
 *
 * Silent only when it knows no run is live, and never non-zero — a broken brief must not take the
 * session down, and queue.md reads silence as "pick a ticket".
 */
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { derive } from "./loop-derive.mjs";

const unknown = (why) => `loop-status could not determine the run: ${why}; do not pick a ticket until resolved`;

export function report(s, reason = process.env.LOOP_REASON) {
  if (!s.onTicket && s.phase === "?") return unknown(s.why);
  if (!s.onTicket) {
    if (!s.ambiguous) return "";
    return [
      "More than one agent/* worktree is live under .worktrees/, and nothing here says which one",
      "this session's run is — that is not the same as no run being live.",
      "",
      `  ${s.why}`,
      "",
      "Resolve which one is the real run before picking a new ticket.",
      "`.claude/commands/queue.md` is the procedure.",
    ].join("\n");
  }
  if (s.phase === "?") {
    return [
      `An autonomous ticket run is live: #${s.ticket}, and it is stuck.`,
      "",
      `  ${s.why}`,
      "",
      "Resolve that before anything else. `.claude/commands/queue.md` is the procedure; do not",
      "restart the ticket.",
    ].join("\n");
  }
  const next =
    {
      C: s.fix
        ? `C (fix round ${s.ciRounds || 1}) — CI failed at ${s.ci?.step ?? "an unnamed step"}; ` +
          "read the CI-RED comment, fix, hand off to D."
        : "C — Build. Commit each slice as you finish it.",
      D: "D — Review. A fresh subagent reads the diff; post its verdict on the issue.",
      E: "E — Land. Run the gate, then the check, then push.",
      G: 'G — Settle. Pushed and waiting for CI; declare {"phase":"G"} and exit, the supervisor lands it.',
    }[s.phase] ?? `${s.phase} — queue.md's section ${s.phase}.`;
  const pr = s.ci?.pr ? `, PR #${s.ci.pr}` : "";
  const ci = s.ci ? [`  ci         ${s.ci.pushed ? "pushed" : "not pushed"}${pr}, ${s.ci.state}`] : [];
  return [
    `An autonomous ticket run is live: #${s.ticket} on \`${s.branch}\`, in ${s.cwd}.`,
    "Resume where it says. Do not re-plan, do not restart the ticket, do not ask whether to",
    "continue. `.claude/commands/queue.md` is the procedure.",
    "",
    `  commits    ${s.commits ?? "?"} against ${s.base}, ${s.changed?.length ?? "?"} file(s)`,
    `  review     ${s.verdict ? s.verdict.line : `none for ${s.head?.slice(0, 7) ?? "this head"}`}`,
    ...ci,
    `  resume at  ${next}`,
    ...(reason ? [`  handed     ${reason}`] : []),
    "",
    `Because: ${s.why}.` +
      (s.dirty
        ? " There are uncommitted changes in that worktree — they are your in-progress slice, so" +
          " finish it rather than starting over."
        : ""),
  ].join("\n");
}

/**
 * A loop process's own start. The hook's output lands ahead of CLAUDE.md and queue.md in the
 * prompt, so a report that differs by phase re-bills ~26k cached tokens per process; queue.md has
 * the session run this itself instead, which puts the report at the end.
 */
export const silentAt = (argv, env) => argv.includes("--startup") && Boolean(env.LOOP_TURNS);

if (isInvokedDirectly(process.argv[1], import.meta.url) && !silentAt(process.argv, process.env)) {
  try {
    const out = report(derive({ ci: true }));
    if (out) console.log(out);
  } catch (err) {
    console.log(unknown(String(err?.message ?? err).split("\n")[0]));
  }
}
