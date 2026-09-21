/**
 * PreToolUse deny for Agent/Task inside a loop session: a dispatch with no `model` inherits the
 * session's, which is what rule 29 of docs/agents/RULES.md exists to prevent. Also denies a
 * dispatch that claims to be one of `brief.mjs`'s kinds without starting with its exact output.
 *
 * Exit 0 always. stdout carries the deny, or nothing.
 */
import { readFileSync } from "node:fs";
import { brief, parseHeader } from "./brief.mjs";

const NAMED = /\b(scope|scoping|recon|completeness|standards|spec|refut\w*|fix review)\b/i;

function denial(payload) {
  const input = payload.tool_input ?? {};
  if (!input.model) {
    return "This dispatch names no model. Add `model` (see rule 29 of docs/agents/RULES.md) and dispatch it again.";
  }
  const prompt = String(input.prompt ?? "");
  const header = parseHeader(prompt);
  if (header) {
    return prompt.startsWith(brief(header.kind, header))
      ? null
      : "This brief was edited. Pass the output of `node tools/loop/brief.mjs <kind> <n> <worktree> <base>` " +
          "verbatim as the start of the prompt; add anything else (the reports to refute, the contract clause) after it.";
  }
  const named = NAMED.exec(String(input.description ?? ""));
  return named
    ? `A ${named[1]} dispatch must start with its brief: run \`node tools/loop/brief.mjs <kind> <n> <worktree> [base]\` ` +
        "and pass its output verbatim, then anything you add after it."
    : null;
}

try {
  const payload = JSON.parse(readFileSync(0, "utf8") || "{}");
  const dispatch = payload?.tool_name === "Agent" || payload?.tool_name === "Task";
  const reason = process.env.LOOP_TURNS && dispatch && !payload.agent_id ? denial(payload) : null;
  if (reason) {
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } })
    );
  }
} catch {
  process.exit(0);
}
