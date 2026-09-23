// tests/tooling/gameRuleDecisions.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
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

// Excludes the working-artefact directories (Task 6's, historical or pending deletion) and
// docs/adr (immutable history).
const EXCLUDED = /^docs\/(adr|plans|research|specs|design)\//;
// `§`, `#` (a markdown anchor link) or nothing at all, with or without a space.
const staleCitation = /BRIEF\.md`?\s*[§#]?\s*3\.1\b/;

function citingOldLocation(): string[] {
  const files = execSync("git ls-files", { cwd: root, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((f) => !EXCLUDED.test(f));
  return files.filter((f) => {
    let text: string;
    try {
      text = readFileSync(path.join(root, f), "utf8");
    } catch {
      return false;
    }
    return staleCitation.test(text);
  });
}

test("no tracked file (outside the excluded archives) still cites BRIEF.md's moved §3.1 table", () => {
  assert.deepEqual(citingOldLocation(), [], "these still cite the moved §3.1 table by its old address");
});
