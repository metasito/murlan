// tests/tooling/docReferences.test.ts
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join, normalize } from "node:path";

// .claude/skills is vendored upstream (the plan's Global Constraints forbid touching it), so a
// code snippet inside it is not a claim this repo's own docs make. Excluded here, not silently:
// this comment is the exclusion's record.
const EXCLUDED_DIRS = [".claude/skills/"];

const docs = execSync('git ls-files "*.md"', { encoding: "utf8" })
  .trim().split("\n").filter((f) => !f.startsWith("node_modules/"))
  .filter((f) => !EXCLUDED_DIRS.some((dir) => f.startsWith(dir)));
const scripts = new Set(Object.keys(JSON.parse(readFileSync("package.json", "utf8")).scripts));
const RULES = "docs/agents/RULES.md";
const ruleNumbers = new Set(
  [...readFileSync(RULES, "utf8").matchAll(/^(\d+)\.\s+\*\*/gm)].map((m) => Number(m[1])),
);

/** `](relative/path.md)` and `](relative/path.md#anchor)`, skipping URLs and bare anchors. */
const LINK = /\]\((?!https?:|mailto:|#)([^)\s#]+)(#[^)\s]*)?\)/g;
/** A repo path inside backticks: `docs/agents/RULES.md`, `lib/game/gameEngine.ts`, `tests/ui-rules/`. */
const CODE_PATH = /`((?:\.?\/)?(?:app|components|context|docs|lib|scripts|server|shared|tests|tools|assets|locales|\.github)\/[\w./@-]+)`/g;
/** `npm run <script>` in prose or a fenced block. */
const NPM_RUN = /npm run ([\w:-]+)/g;
/**
 * A `rule N` citation, in prose or bold. Not backtick-quoted anywhere in the repo, so no
 * backtick requirement here (unlike CODE_PATH) — matching plain text is what the citations are.
 */
const RULE_CITATION = /\b[Rr]ule (\d+)\b/g;

test("every relative link in a doc resolves", () => {
  const broken: string[] = [];
  for (const doc of docs) {
    const body = readFileSync(doc, "utf8");
    for (const [, target] of body.matchAll(LINK)) {
      const resolved = normalize(join(dirname(doc), target));
      if (!existsSync(resolved)) broken.push(`${doc} -> ${target}`);
    }
  }
  assert.deepEqual(broken, []);
});

test("every repo path a doc names in backticks exists", () => {
  const broken: string[] = [];
  for (const doc of docs) {
    const body = readFileSync(doc, "utf8");
    for (const [, target] of body.matchAll(CODE_PATH)) {
      if (!existsSync(normalize(target.replace(/\/$/, "")))) broken.push(`${doc} -> ${target}`);
    }
  }
  assert.deepEqual(broken, []);
});

test("every npm script a doc names is defined", () => {
  const broken: string[] = [];
  for (const doc of docs) {
    for (const [, name] of readFileSync(doc, "utf8").matchAll(NPM_RUN)) {
      if (!scripts.has(name)) broken.push(`${doc} -> npm run ${name}`);
    }
  }
  assert.deepEqual(broken, []);
});

test("every rule N citation names a rule that exists in RULES.md", () => {
  const broken: string[] = [];
  for (const doc of docs) {
    for (const [, num] of readFileSync(doc, "utf8").matchAll(RULE_CITATION)) {
      if (!ruleNumbers.has(Number(num))) broken.push(`${doc} -> rule ${num}`);
    }
  }
  assert.deepEqual(broken, []);
});

test("the check reads the doc set from git, not from a list", () => {
  assert.ok(docs.length > 10, `expected the tracked doc set, got ${docs.length}`);
});
