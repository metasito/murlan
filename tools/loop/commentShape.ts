/**
 * The only place this repo decides what a comment line is — `tests/tooling/docReferences.test.ts`
 * reads it here, so the rule cannot come to mean two things.
 */

export type Line = { n: number; text: string; kind: "comment" | "code" | "blank" };

const HASH_COMMENTED = /\.(ya?ml|sh)$/;

/**
 * A comment marker inside a string literal is not a comment. This is what lets a file *about* the
 * comment rules be written at all — its examples are string literals holding `//`, and without this
 * its own tests' examples would read as comments.
 *
 * Known limit: a template literal spanning lines is unterminated on each of them, so a `//` opening
 * a line inside one reads as a comment. Pinned by a test rather than fixed — tracking template state
 * costs more than the case is worth.
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
