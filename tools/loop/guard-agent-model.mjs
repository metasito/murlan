/**
 * PreToolUse deny for Agent/Task inside a loop session: a dispatch with no `model` inherits the
 * session's, which is what rule 29 of docs/agents/RULES.md exists to prevent.
 *
 * Exit 0 always. stdout carries the deny, or nothing.
 */
import { readFileSync } from "node:fs";

try {
  const payload = JSON.parse(readFileSync(0, "utf8") || "{}");
  const dispatch = payload?.tool_name === "Agent" || payload?.tool_name === "Task";
  if (process.env.LOOP_TURNS && dispatch && !payload.tool_input?.model) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason:
            "This dispatch names no model. Add `model` (see rule 29 of docs/agents/RULES.md) and dispatch it again.",
        },
      })
    );
  }
} catch {
  process.exit(0);
}
