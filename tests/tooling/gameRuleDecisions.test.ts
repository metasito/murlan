// tests/tooling/gameRuleDecisions.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

test("decided game rules are stated in GAME-RULES.md, not in BRIEF.md", () => {
  const rules = read("docs/GAME-RULES.md");
  const brief = read("docs/BRIEF.md");
  assert.match(rules, /^## Decisions$/m);
  // The rows moved: each of these phrases is now in the rules, and no longer in the brief.
  for (const phrase of ["The offline turn clock", "A match ended by the unanimous vote", "Who starts a matchmade table"]) {
    assert.ok(rules.includes(phrase), `GAME-RULES.md is missing: ${phrase}`);
    assert.ok(!brief.includes(phrase), `BRIEF.md still states: ${phrase}`);
  }
});
