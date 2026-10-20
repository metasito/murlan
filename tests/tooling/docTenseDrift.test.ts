import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Words that said "as the app stands" in a doc and went false when the app changed. */
const DRIFT =
  /\b(currently|today|(?:is|are) now|now (?:implies|decides|does|has)|current (?:\d+-per|engine|behaviou?r|deal)|not built|is wrong)\b/i;

const SCANNED = [
  "docs/BETA-PLAYTEST.md",
  "docs/DISCONNECT-POLICY.md",
  "docs/GAME-RULES.md",
];

/** A line that may carry a drift word because the word is not a claim about the app's present state. */
const ALLOWED: { file: string; includes: string; why: string }[] = [
  {
    file: "docs/GAME-RULES.md",
    includes: 'catsatcards: *"If there are three consecutive',
    why: "quoted source text",
  },
  {
    file: "docs/DISCONNECT-POLICY.md",
    includes: "`round_history` did",
    why: "a record of when a cost note became moot, dated by its own sentence",
  },
  {
    file: "docs/DISCONNECT-POLICY.md",
    includes: "current round",
    why: "'the round in progress', not a claim about the app",
  },
  {
    file: "docs/DISCONNECT-POLICY.md",
    includes: "(today every key accumulates;",
    why: "§7 row D, accurate and kept by the ticket",
  },
  {
    file: "docs/DISCONNECT-POLICY.md",
    includes: "now moot",
    why: "see round_history line",
  },
];

export function driftIn(
  file: string,
  text: string,
  allowed = ALLOWED,
): string[] {
  return text
    .split("\n")
    .flatMap((line, i) =>
      DRIFT.test(line) &&
      !allowed.some((a) => a.file === file && line.includes(a.includes))
        ? [`${file}:${i + 1}: ${line.trim().slice(0, 140)}`]
        : [],
    );
}

test("a doc does not describe the app in the present tense of the day it was written", () => {
  const hits = SCANNED.flatMap((file) =>
    driftIn(file, readFileSync(join(ROOT, file), "utf8")),
  );
  assert.deepEqual(hits, []);
});

test("each drift word is caught, and the allowlist exempts only its own line", () => {
  for (const word of [
    "currently",
    "is now",
    "today",
    "now decides",
    "current engine",
    "not built",
    "is wrong",
  ]) {
    assert.equal(driftIn("docs/X.md", `The app ${word} it.`).length, 1, word);
  }
  const allowed = [{ file: "docs/X.md", includes: "quoted", why: "test" }];
  assert.equal(driftIn("docs/X.md", "a quoted today", allowed).length, 0);
  assert.equal(driftIn("docs/Y.md", "a quoted today", allowed).length, 1);
  assert.equal(driftIn("docs/X.md", "plain today", allowed).length, 1);
});
