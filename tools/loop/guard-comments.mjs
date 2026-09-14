/**
 * PreToolUse deny for Write/Edit. CLAUDE.md's comment rules are documented as advisory, and 26% of
 * this repo's line churn is comments — the measurement saying advisory did not hold.
 *
 * Denies with a reason the model is shown, so it rewrites the edit rather than losing the turn.
 *
 * Ratio is judged on the file the write will leave behind, against the revision it was committed
 * at — the same quantity `comment-budget.mjs` reports in CI, from the same functions. Judging the
 * fragment instead lets a file go over six edits at a time, none of them over on its own.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { floorFor, violations } from "./commentShape.ts";
import { addedCounts } from "./comment-budget.mjs";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";

const JUDGED = /\.(mjs|cjs|js|jsx|ts|tsx)$/;

/** `comment-budget.mjs`'s own default base, so the two measure from the same revision. */
const BASE = "origin/main";

export const io = {
  /**
   * The file at the branch's merge base, which is the revision `comment-budget.mjs` measures from.
   * `HEAD` would be a baseline that advances with every commit, and phase C commits every slice —
   * so a branch could add its prose a commit at a time and never be over against any of them.
   *
   * "" for a path git does not have, which is what an added file's base is. `-C` its own directory
   * and `:./` against that, because the hook is handed an absolute path and `<rev>:C:/…` resolves
   * for no file — which would count every line of every file as added and deny the next edit to
   * anything.
   */
  committed: (file) => {
    const git = (...args) =>
      execFileSync("git", args, {
        cwd: dirname(file),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 64 * 1024 * 1024,
      });
    let from = "HEAD";
    try {
      from = git("merge-base", BASE, "HEAD").trim();
    } catch {
      // No `origin/main` here — a fresh clone, or a repo that names its trunk something else.
    }
    try {
      return git("show", `${from}:./${basename(file)}`);
    } catch {
      return "";
    }
  },
  /** null, not "": a file that cannot be read is one whose ratio nothing here may claim to know. */
  disk: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
};

/**
 * Edit's own semantics: the first occurrence, or every one under `replace_all`.
 *
 * By index, never `String.replace` with a string: that reads `$&`, `$1` and `` $` `` in the
 * replacement, so an edit whose new text is itself about a regex would be simulated as something
 * the file will never hold, and judged on it.
 */
const applied = (before, { old_string: from, new_string: to, replace_all: all }) => {
  if (all) return before.split(from).join(to);
  const at = before.indexOf(from);
  return at < 0 ? before : before.slice(0, at) + to + before.slice(at + from.length);
};

export function decide(payload, { committed = io.committed, disk = io.disk } = {}) {
  const input = payload?.tool_input;
  const path = input?.file_path;
  if (!path || !JUDGED.test(path)) return { deny: false };

  const whole = payload.tool_name === "Write";
  const text = whole ? input.content : input.new_string;
  if (typeof text !== "string" || !text) return { deny: false };

  const found = violations(text);

  const before = disk(path);
  const after = whole ? text : typeof input.old_string === "string" && before !== null
    ? applied(before, input)
    : null;
  if (after !== null) {
    const added = addedCounts(committed(path), after);
    // `comment-budget.mjs`'s floor, deliberately without its prose-only one. Rewording three lines
    // of an existing comment adds three comment lines and no code, and denying that would stop an
    // unattended ticket over an improvement. The tighter floor stays CI's, where a miss costs a
    // report rather than a turn.
    if (added.comment > floorFor(path) && added.comment > added.code) {
      found.push({
        rule: "ratio",
        line: 1,
        text: `${added.comment} comment lines to ${added.code} of code, across the whole file`,
        why: "CLAUDE.md: a change adding more comment lines than code is explaining itself instead of being clear.",
      });
    }
  }

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
