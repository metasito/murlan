/**
 * CLAUDE.md's comment rules as a check rather than a paragraph, and the only place this repo
 * decides what a comment line is — `comment-budget.mjs` and the write-time hook both read it here,
 * so the rule cannot come to mean two things.
 *
 * Two detectors, both narrow: this feeds a `PreToolUse` deny, and a false positive stops an
 * unattended ticket. "Restates the line below" is deliberately absent — it is the one that cannot
 * be decided without guessing, and the ratio arm covers its practical case.
 *
 * `history` is a property of a line and is never wrong about a fragment. `ratio` is a property of a
 * *file*, so a caller holding only part of one reports the first and leaves the second to whoever
 * can see the whole.
 */

export type Line = { n: number; text: string; kind: "comment" | "code" | "blank" };
export type Violation = { rule: "history" | "ratio"; line: number; text: string; why: string };

/**
 * Each phrase names the code's own past, which is the one thing a comment may never do. Anchored on
 * the subject rather than the verb: "no longer" alone is ordinary prose about runtime state, so every
 * entry carries the word that makes it archeology rather than description.
 *
 * Plain phrases, never patterns — the test asserts both that each one is caught and that none holds
 * a regex metacharacter, so a phrase cannot be added that silently matches nothing or everything.
 */
export const ARCHEOLOGY = [
  "previously", "formerly", "renamed from", "moved from", "was changed to", "instead of the old",
  "legacy behavior", "legacy behaviour",
  "used to be", "used to have", "used to return", "used to call", "used to live",
  "this used to", "this was formerly",
  "before this fix", "before this change", "before this commit",
  "the bug was", "the defect was", "the issue was",
  "we now", "we changed", "we switched", "we renamed",
  "no longer needed", "no longer used", "no longer necessary", "no longer required",
  "as of this commit", "as of this change", "as of this fix",
];

export const HISTORY = new RegExp(`\\b(${ARCHEOLOGY.join("|")})\\b`, "i");

const TEST_PATH = /(^|[\\/])tests?[\\/]|\.(test|spec)\.[jt]sx?$/;

/** A test's own description says what it covers, so its prose budget is tighter than source's. */
export function floorFor(path: string): number {
  return TEST_PATH.test(path) ? 3 : 6;
}

/**
 * A comment marker inside a string literal is not a comment. This is what lets a file *about* the
 * comment rules be written at all — its examples are string literals holding `//`, and without this
 * the guard would refuse every edit to its own tests.
 *
 * Known limit: a template literal spanning lines is unterminated on each of them, so a `//` opening
 * a line inside one reads as a comment. Pinned by a test rather than fixed — tracking template state
 * costs more than the case is worth, and `comment-budget.mjs` judges committed bytes either way.
 */
const blankStrings = (line: string) => line.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""');

export function classify(text: string): Line[] {
  const out: Line[] = [];
  let block = false;
  text.split("\n").forEach((raw, i) => {
    const line = blankStrings(raw).trim();
    const at = { n: i + 1, text: raw.trim() };
    if (block) {
      out.push({ ...at, kind: "comment" });
      if (line.includes("*/")) block = false;
    } else if (!line) {
      out.push({ ...at, kind: "blank" });
    } else if (line.startsWith("//")) {
      out.push({ ...at, kind: "comment" });
    } else if (line.startsWith("/*")) {
      out.push({ ...at, kind: "comment" });
      block = !line.includes("*/", 2);
    } else {
      out.push({ ...at, kind: "code" });
    }
  });
  return out;
}

export function violations(text: string, path: string): Violation[] {
  const lines = classify(text);
  const comments = lines.filter((l) => l.kind === "comment");
  const code = lines.filter((l) => l.kind === "code").length;

  const found: Violation[] = comments
    .filter((c) => HISTORY.test(c.text))
    .map((c) => ({
      rule: "history" as const,
      line: c.n,
      text: c.text,
      why: "CLAUDE.md: never any history of what the code was. That belongs in the commit message.",
    }));

  const floor = floorFor(path);
  if (comments.length > floor && comments.length > code) {
    found.push({
      rule: "ratio",
      line: comments[0].n,
      text: `${comments.length} comment lines to ${code} of code`,
      why: "CLAUDE.md: a change adding more comment lines than code is explaining itself instead of being clear.",
    });
  }
  return found;
}
