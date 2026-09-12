// tests/loaderConstraintIsSingleSourced.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Where the constraint is explained. Every file it governs points here instead. */
const AUTHORITY = "docs/agents/loops.md";

/**
 * A pointer, as written: the path, then the section it quotes. The class between the two
 * absorbs a wrap — three of these run past the margin and carry the quote on the next
 * comment line, and a single-line pattern reads them as no pointer at all.
 */
const POINTER = /docs\/agents\/loops\.md[,)]?[\s/#*]*"([^"\n]+)"/g;

const SELF = "tests/loaderConstraintIsSingleSourced.test.ts";

/**
 * The wordings a restatement reaches for. The authority uses them too, which is what makes the
 * list checkable rather than a guess: the assertion below names the file that must match. It
 * catches a paste and a near-paraphrase; a restatement in wholly fresh words would pass, and
 * widening this on the day one appears is the maintenance it asks for. The structural
 * alternative — flagging any long comment block about the loader — trips on unrelated blocks
 * in this tree, so it would ship with an exemption list instead.
 */
const EXPLAINS =
  /type-strip|strips plain|cannot parse (a |the )?(\.tsx|JSX)|(?:bundler|tsconfig|`paths`)[\s\S]{0,30}alias/i;

/** Everything above, as it is written here. Blanked in this file only — see `source`. */
const DECLARATION = /const EXPLAINS =[\s\S]*?;/;

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

/**
 * A tracked file's text, or "" for a binary one — git's own heuristic, a NUL in the first
 * 8000 bytes. No extension list: a restatement in a workflow, a shell script or a `.txt` is
 * the same restatement, and a list of suffixes is a blind spot that grows on its own.
 *
 * This file is scanned like any other, minus the one declaration that has to quote the
 * wordings in order to find them. Skipping the whole file would exempt the guard's own prose.
 */
function source(file: string): string {
  const buf = readFileSync(path.join(repoRoot, file));
  if (buf.subarray(0, 8000).includes(0)) return "";
  const text = buf.toString("utf8");
  return file === SELF ? text.replace(DECLARATION, "") : text;
}

describe("the Node loader constraint is written down once", () => {
  // One assertion pins the count *and* the place, and it is its own floor: a pattern that
  // stopped matching, or an authority that was deleted, empties the list and fails here.
  test(`only ${AUTHORITY} explains it`, () => {
    const offenders = tracked.filter((f) => EXPLAINS.test(source(f)));
    assert.deepEqual(
      offenders,
      [AUTHORITY],
      `these files explain Node's TypeScript loader themselves: ${offenders.join(", ")}. ` +
        `State it once in ${AUTHORITY} and carry a one-line pointer at it.`
    );
  });

  // Derived from the pointers rather than from a constant naming the section: a check that
  // asserts what the tree says every pointer does cannot disagree with a pointer that does not.
  test(`every section a pointer cites exists in ${AUTHORITY}`, () => {
    const headings = source(AUTHORITY).match(/^#+ .+$/gm) ?? [];
    const cited = tracked.flatMap((f) =>
      [...source(f).matchAll(POINTER)].map(([, section]) => ({ file: f, section }))
    );
    assert.ok(cited.length > 0, `nothing cites a section of ${AUTHORITY}; the pointers went away`);
    const dangling = cited.filter((c) => !headings.some((h) => h.includes(c.section)));
    assert.deepEqual(
      dangling.map((c) => `${c.file} → "${c.section}"`),
      [],
      `${AUTHORITY} has no such heading any more`
    );
  });
});
