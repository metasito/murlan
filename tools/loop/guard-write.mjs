/**
 * PreToolUse for Write|Edit|NotebookEdit in a loop session: the shared checkout is another
 * session's (RULES.md rules 8 and 31), and nothing outside the repo is scratch (rule 32). Only
 * `.worktrees/` and `.loop-logs/` are writable. Exit 0 always; stdout carries the deny, or nothing.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";

const inside = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

export function verdict(filePath, root, cwd = root) {
  const p = path.resolve(cwd, filePath);
  if (inside(p, path.join(root, ".worktrees")) || inside(p, path.join(root, ".loop-logs"))) return null;
  if (!inside(p, root)) {
    return `This writes ${p}, outside the repo. A loop session's scratch goes under .loop-logs/ (rule 32), its work in .worktrees/agent-<n>/.`;
  }
  return (
    `This writes ${path.relative(root, p)} in the shared checkout, where another session stands. ` +
    "Write it in your worktree (.worktrees/agent-<n>/), or under .loop-logs/ for a scratch file."
  );
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  try {
    const payload = JSON.parse(readFileSync(0, "utf8") || "{}");
    const file = payload?.tool_input?.file_path ?? payload?.tool_input?.notebook_path;
    if (process.env.LOOP_TURNS && file) {
      const cwd = payload.cwd ?? process.cwd();
      const common = execFileSync("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      const reason = verdict(file, path.dirname(common), cwd);
      if (reason) {
        process.stdout.write(
          JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }),
        );
      }
    }
  } catch {
    process.exit(0);
  }
}
