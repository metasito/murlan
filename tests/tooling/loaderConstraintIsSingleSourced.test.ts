// tests/tooling/loaderConstraintIsSingleSourced.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Where the constraint is explained. Every file it governs points here instead. */
const AUTHORITY = "docs/agents/loops.md";

/** The section within it. Each pattern below is required to match inside this, not the file. */
const SECTION = "Node's TypeScript loader reaches plain `.ts` only";

/**
 * A pointer, as written: the path, then the section it quotes. The class between the two
 * absorbs a wrap — three of these run past the margin and carry the quote on the next
 * comment line, and a single-line pattern reads them as no pointer at all.
 */
const POINTER = /docs\/agents\/loops\.md[,)]?[\s/#*]*"([^"\n]+)"/g;

const SELF = "tests/tooling/loaderConstraintIsSingleSourced.test.ts";

/**
 * The files that carry a pointer, named rather than counted: any floor on a count is satisfied
 * by any surviving majority, so it cannot say which one went. Gaining a pointer is not a test
 * edit; losing one is, and the diff has to name the file that stopped needing it.
 */
const PINNED = [
  ".github/workflows/ci.yml",
  "components/cardFaceModel.ts",
  "components/flightPhysics.ts",
  "components/handLayout.ts",
  "components/handOrder.ts",
  "components/homeCardField.ts",
  "components/seatLayout.ts",
  "components/table/stagedPlay.ts",
  "components/tableA11y.ts",
  "components/tableArc.ts",
  "components/tableFrame.ts",
  "components/turnTimerUi.ts",
  "docs/TESTING.md",
  "jest.config.js",
  "lib/game/autoMove.ts",
  "lib/game/botPersonalities.ts",
  "lib/cardNames.ts",
  "lib/cosmetics.ts",
  "lib/i18n.ts",
  "lib/game/matchState.ts",
  "lib/game/rating.ts",
  "lib/reactions.ts",
  "lib/game/replay.ts",
  "lib/game/sharedGameFlow.ts",
  "lib/game/standings.ts",
  "tests/ui-rules/contrast.test.ts",
];

/**
 * The wordings a restatement reaches for, one pattern per distinct wording so the floor below can
 * fail each on its own. The authority uses them all, which is what makes the list checkable rather
 * than a guess. It catches a paste and a near-paraphrase; a restatement in wholly fresh words would
 * pass, and widening this on the day one appears is the maintenance it asks for. The structural
 * alternative — flagging any long comment block about the loader — trips on unrelated blocks
 * in this tree, so it would ship with an exemption list instead.
 */
const EXPLAINS = [
  /type-strip/i,
  /cannot parse (a |the )?(`?\.tsx`?|JSX)/i,
  /(?:bundler|tsconfig|`paths`)[\s\S]{0,30}alias/i,
  /cannot load `?react-native`?/i,
  /(?:free of|no)(?: any)? `?react-native`? import/i,
  /Flow-typed/i,
];

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
  // The floor, and it is per pattern: matching the whole file would let a wording lifted from
  // the starvation or Reanimated sections satisfy a pattern that then catches nothing.
  test(`every pattern matches ${AUTHORITY} § "${SECTION}"`, () => {
    const body = source(AUTHORITY)
      .split(/^## /m)
      .find((s) => s.startsWith(SECTION));
    assert.ok(body, `${AUTHORITY} no longer has a section headed "${SECTION}"`);
    assert.deepEqual(
      EXPLAINS.filter((p) => !p.test(body)).map(String),
      [],
      "these patterns match nothing in the section they are meant to describe"
    );
  });

  test(`only ${AUTHORITY} explains it`, () => {
    const offenders = tracked.filter((f) => EXPLAINS.some((p) => p.test(source(f))));
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
    const citing = new Set(cited.map((c) => c.file));
    assert.deepEqual(
      PINNED.filter((f) => !citing.has(f)),
      [],
      `these files cited a section of ${AUTHORITY} and no longer do. Restore the pointer, or ` +
        `drop the file from PINNED in the commit that says why it stopped needing one.`
    );
    const dangling = cited.filter((c) => !headings.some((h) => h.includes(c.section)));
    assert.deepEqual(
      dangling.map((c) => `${c.file} → "${c.section}"`),
      [],
      `${AUTHORITY} has no such heading any more`
    );
  });
});
