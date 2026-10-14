/**
 * PreToolUse deny for Agent/Task, registered by loop-settings.json alone: a dispatch with no `model` or no `effort`
 * inherits the session's, which is what rule 29 of docs/agents/RULES.md exists to prevent. A review, scope or
 * completeness check runs only as its `loop-<kind>` agent, whose file sets both.
 *
 * Exit 0 always. stdout carries the deny, or nothing.
 */
import { readFileSync } from "node:fs";
import { KINDS, parseHeader } from "./brief.mjs";

const NAMED = /\b(completeness check|standards review|spec review|refut\w* (?:review )?findings|fix review)\b|^\W*(scope issue|review #\d+ round \d+)\b/i;
const KIND = /\b(completeness|standards|spec|refut\w*|scope)\b/i;
const ROLE = /\b(review\w*|axis|findings?)\b/i;
const AGENTS = KINDS.map((k) => `\`loop-${k}\``).join(", ");

/** A `loop-<kind>` agent's file sets its model and effort, so the dispatch may not; its prompt still opens with that kind's brief. */
function namedDenial(input) {
  const type = String(input.subagent_type);
  const kind = type.slice("loop-".length);
  if (!KINDS.includes(kind)) return `There is no loop agent \`${type}\`. Dispatch one of ${AGENTS}.`;
  if ("model" in input || "effort" in input) {
    return `\`${type}\` sets its own model and effort in .claude/agents/${type}.md. Dispatch it again without a per-call override.`;
  }
  if (parseHeader(String(input.prompt ?? "").replace(/\r\n/g, "\n"))?.kind !== kind) {
    return `\`${type}\` runs a ${kind} brief: start its prompt with the output of \`node tools/loop/brief.mjs ${kind} <n> <worktree> [base]\`.`;
  }
  return null;
}

function denial(payload) {
  const input = payload.tool_input ?? {};
  if (String(input.subagent_type ?? "").startsWith("loop-")) return namedDenial(input);
  const header = parseHeader(String(input.prompt ?? "").replace(/\r\n/g, "\n"));
  const d = String(input.description ?? "");
  const named = header?.kind ?? NAMED.exec(d)?.slice(1).find(Boolean) ?? (KIND.test(d) && ROLE.test(d) ? KIND.exec(d)[1] : null);
  if (named) {
    return `A ${named} dispatch runs as its loop agent: dispatch one of ${AGENTS} with the output of ` +
      "`node tools/loop/brief.mjs <kind> <n> <worktree> [base]` as its prompt, and no model or effort.";
  }
  if (!input.model) {
    return "This dispatch names no model. Add `model` (see rule 29 of docs/agents/RULES.md) and dispatch it again.";
  }
  if (!input.effort) {
    return "This dispatch names no effort, so it inherits the session's. Add `effort` (rule 29 of docs/agents/RULES.md) and dispatch it again.";
  }
  return null;
}

try {
  const payload = JSON.parse(readFileSync(0, "utf8") || "{}");
  const dispatch = payload?.tool_name === "Agent" || payload?.tool_name === "Task";
  const reason = dispatch && !payload.agent_id ? denial(payload) : null;
  if (reason) {
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } })
    );
  }
} catch {
  process.exit(0);
}
