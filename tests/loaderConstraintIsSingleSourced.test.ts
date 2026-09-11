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

/** This file quotes the phrasings in order to find them, so it cannot count itself. */
const SELF = "tests/loaderConstraintIsSingleSourced.test.ts";

/**
 * Any restatement carries one of these, whatever wording it reaches for: the loader
 * strips types, refuses JSX, or resolves no alias. Matching the claim rather than one
 * sentence is what makes a fresh paraphrase fail too — five files held the same seven
 * lines verbatim and nothing could see the sixth paste coming (#983).
 */
const EXPLAINS =
  /type-strip|strips plain|cannot parse (a |the )?(\.tsx|JSX)|bundler alias|path alias/i;

/** Tracked text, which is every file a paste could land in and no file it could not. */
const files = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx|mjs|cjs|js|md)$/.test(f) && f !== SELF);

describe("the Node loader constraint is written down once", () => {
  // One assertion pins the count *and* the place, and it is its own floor: a pattern that
  // stopped matching, or an authority that was deleted, empties the list and fails here.
  test(`only ${AUTHORITY} explains it`, () => {
    const offenders = files.filter((f) =>
      EXPLAINS.test(readFileSync(path.join(repoRoot, f), "utf8"))
    );
    assert.deepEqual(
      offenders,
      [AUTHORITY],
      `these files explain Node's TypeScript loader themselves: ${offenders.join(", ")}. ` +
        `State it once in ${AUTHORITY} and carry a one-line pointer at it.`
    );
  });
});
