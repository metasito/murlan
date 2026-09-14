/**
 * PreToolUse deny for Write/Edit. CLAUDE.md's comment rules are documented as advisory, and 26% of
 * this repo's line churn is comments — the measurement saying advisory did not hold.
 *
 * Denies with a reason the model is shown, so it rewrites the edit rather than losing the turn. It
 * sees one write; `comment-budget.mjs` reads committed bytes in CI and covers every other route in.
 */
import { readFileSync } from "node:fs";
import { violations } from "./commentShape.ts";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";

const JUDGED = /\.(mjs|cjs|js|jsx|ts|tsx)$/;

export function decide(payload) {
  const input = payload?.tool_input;
  if (!input?.file_path || !JUDGED.test(input.file_path)) return { deny: false };

  // A Write carries the whole file; an Edit carries a fragment, and a fragment has no ratio — a
  // docblock added above an existing function is all comment and no code, and is exactly what
  // CLAUDE.md's four exceptions allow. The file's ratio is `comment-budget.mjs`'s to judge.
  const whole = payload.tool_name === "Write";
  const text = whole ? input.content : input.new_string;
  if (typeof text !== "string" || !text) return { deny: false };

  const found = violations(text, input.file_path).filter((v) => whole || v.rule === "history");
  if (!found.length) return { deny: false };

  const said = found.map((v) => `  line ${v.line}: ${v.text}\n    ${v.why}`).join("\n");
  return { deny: true, reason: `This write breaks CLAUDE.md's comment rules. Rewrite without them:\n${said}` };
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  let payload = null;
  try {
    payload = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    process.exit(0); // an unreadable payload must never disturb a tool call
  }
  const out = decide(payload);
  if (out.deny) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: out.reason,
        },
      })
    );
  }
  process.exit(0);
}
