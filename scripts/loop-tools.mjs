import { readFileSync } from "node:fs";

/**
 * `queue.md`'s `allowed-tools` frontmatter governs permission, not what is loaded, so a session
 * declaring ten tools still carries every tool the build has — about 876 tokens each, measured.
 * Passing the same list as `--tools` makes the declaration mean what it looks like it means.
 *
 * Parsed from the file rather than repeated here: a second copy of a list is a premise that decays,
 * and `tests/loopDocsAreExecutable.test.ts` holds the two together.
 */
export function allowedTools(text) {
  const m = /^allowed-tools:\s*(.+)$/m.exec(text);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const readAllowedTools = (file = ".claude/commands/queue.md") =>
  allowedTools(readFileSync(file, "utf8"));
