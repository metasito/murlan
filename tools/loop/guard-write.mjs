/**
 * PreToolUse for Write|Edit|NotebookEdit, registered by loop-settings.json alone: the shared checkout is another
 * session's (RULES.md rules 8 and 31), and nothing outside the repo is scratch (rule 32). Only
 * `.worktrees/` and `.loop-logs/` are writable, bar the evidence artefacts `loop-logs.mjs` marks. stdout carries
 * the deny, or nothing. An unreadable payload exits 0 (ADR-0010); a call it cannot judge exits 2.
 */
import { readFileSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { checkoutRoot, firstLine } from "./cli.mjs";
import { DIR, isEvidence } from "./loop-logs.mjs";

const inside = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/** The path with every link on it followed, as far as it exists: a symlink named anything can stand for the record. */
function followed(p) {
  for (let hops = 0; hops < 16; hops++) {
    let target;
    try {
      target = readlinkSync(p);
    } catch {
      break;
    }
    p = path.resolve(path.dirname(p), target);
  }
  try {
    return realpathSync(p);
  } catch {
    try {
      return path.join(realpathSync(path.dirname(p)), path.basename(p));
    } catch {
      return p;
    }
  }
}

const KEY = /(^|[\\/])murlan-loop([\\/]|$)|evidence\.key$/i;
const names = (p) => [p, followed(p)];

export function verdict(filePath, root, cwd = root) {
  const p = path.resolve(cwd, filePath);
  if (names(p).some((n) => KEY.test(n))) return "That is the supervisor's evidence key. A session never writes it.";
  if (names(p).some((n) => path.basename(path.dirname(n)).toLowerCase() === DIR && isEvidence(n))) {
    return `${path.basename(p)} is the loop's record of what ran, and the gate reads it as proof: only the supervisor writes it. A scratch file goes under ${DIR}/ by another name.`;
  }
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
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch (err) {
    process.stderr.write(`guard-write: could not read the tool call on stdin (${firstLine(err)}); allowing it.\n`);
    process.exit(0);
  }
  const file = payload?.tool_input?.file_path ?? payload?.tool_input?.notebook_path;
  if (file) {
    try {
      const cwd = payload.cwd ?? process.cwd();
      const reason = verdict(file, checkoutRoot(cwd), cwd);
      if (reason) {
        process.stdout.write(
          JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }),
        );
      }
    } catch (err) {
      process.stderr.write(`guard-write: could not judge this call (${firstLine(err)}); refusing it.\n`);
      process.exit(2);
    }
  }
}
