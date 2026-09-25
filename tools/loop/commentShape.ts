/**
 * CLAUDE.md's comment rules as a check rather than a paragraph, and the only place this repo
 * decides what a comment line is — `comment-budget.mjs` and the write-time hook both read it here,
 * so the rule cannot come to mean two things.
 *
 * One detector, narrow on purpose: this feeds a `PreToolUse` deny, and a false positive stops an
 * unattended ticket. "Restates the line below" is deliberately absent — it is the one that cannot
 * be decided without guessing, and the budget's ratio covers its practical case.
 */

export type Line = { n: number; text: string; kind: "comment" | "code" | "blank" };
export type Violation = { rule: "history"; line: number; text: string; why: string };

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

/** What both the write hook and the branch check judge; one list, or a file one sees slips the other. */
export const JUDGED_EXTENSIONS = ["mjs", "cjs", "js", "jsx", "ts", "tsx", "yml", "yaml", "sh"];

const HASH_COMMENTED = /\.(ya?ml|sh)$/;

const TEST_PATH =/(^|[\\/])tests?[\\/]|\.(test|spec)\.[jt]sx?$/;

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

/**
 * Owner's decision on #1294: a YAML key and the shell in a `run: |` block are both code, and a line
 * opening with `#` is a comment wherever it sits. A shebang names the interpreter; it is not prose.
 */
const classifyHashed = (text: string): Line[] =>
  text.split("\n").map((raw, i) => {
    const line = raw.trim();
    const prose = line.startsWith("#") && !(i === 0 && line.startsWith("#!"));
    return { n: i + 1, text: line, kind: !line ? "blank" : prose ? "comment" : "code" };
  });

export function classify(text: string, path: string): Line[] {
  if (HASH_COMMENTED.test(path)) return classifyHashed(text);
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

/**
 * Ratio is not here. It is a property of what a *change* adds, which needs the revision the change
 * started from — so both enforcers ask `addedCounts` against that revision and compare on
 * `floorFor`. A whole-file ratio computed here would be a third reading of one rule, and the two
 * that can be reached would not be the one under test.
 */
export function violations(text: string, path: string): Violation[] {
  return classify(text, path)
    .filter((l) => l.kind === "comment" && HISTORY.test(l.text))
    .map((c) => ({
      rule: "history" as const,
      line: c.n,
      text: c.text,
      why: "CLAUDE.md: never any history of what the code was. That belongs in the commit message.",
    }));
}
