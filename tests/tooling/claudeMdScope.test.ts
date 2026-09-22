// tests/tooling/claudeMdScope.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

const BUDGET: Record<string, number> = {
  "CLAUDE.md": 1000,
  "components/CLAUDE.md": 700,
  "server/CLAUDE.md": 700,
  ".claude/commands/queue.md": 2600,
};

// A term belongs to the file whose directory its reader is already in: the root file is
// loaded on every turn, the nested ones only when that directory is being read.
const OWNED: Record<string, string[]> = {
  "components/CLAUDE.md": ["CARD_W", "zIndex", "Layer.felt", "impactDelayMs", "a11yHidden", "supportedOrientations"],
  "server/CLAUDE.md": ["schemaDdl", "DEDUPE_ON_BOOT", "tablesFilter", "bootEnv", "deploy/runtime.json"],
};

for (const [file, budget] of Object.entries(BUDGET)) {
  test(`${file} is within its budget`, () => {
    assert.ok(words(read(file)) <= budget, `${file} is ${words(read(file))} words, budget ${budget}`);
  });
}

test("a scoped term is stated in exactly one CLAUDE.md", () => {
  const bodies = Object.keys(BUDGET).map((f) => [f, read(f)] as const);
  const strays: string[] = [];
  for (const [owner, terms] of Object.entries(OWNED)) {
    for (const term of terms) {
      for (const [file, body] of bodies) {
        if (file !== owner && body.includes(term)) strays.push(`${term} in ${file}, owned by ${owner}`);
      }
    }
  }
  assert.deepEqual(strays, []);
});
