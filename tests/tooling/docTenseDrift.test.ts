import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DRIFT = /\b(currently|today|not built)\b/i;

/** Lines holding quoted source text, where the word belongs to the source and not to the doc. */
const QUOTED_SOURCE_ALLOWLIST: Record<string, string[]> = {
  "docs/BETA-PLAYTEST.md": [],
};

test("a playtest sheet asks what the app does, never what it does 'today'", () => {
  for (const [file, allowed] of Object.entries(QUOTED_SOURCE_ALLOWLIST)) {
    const hits = readFileSync(join(ROOT, file), "utf8")
      .split("\n")
      .flatMap((line, i) =>
        DRIFT.test(line) && !allowed.some((a) => line.includes(a)) ? [`${file}:${i + 1}: ${line.trim()}`] : [],
      );
    assert.deepEqual(hits, [], "present-tense drift words go stale when the app changes");
  }
});
