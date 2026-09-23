// tests/tooling/docReferences.test.ts
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join, normalize } from "node:path";
import { classify } from "../../tools/loop/commentShape.ts";

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

/**
 * A repo-relative `docs/` mention in a *comment*, backticked or bare, or on any line of a
 * `PROMPT_SOURCES` file, whose prompts are prose held in string literals. `classify()` (the same
 * source `comment-budget.mjs` reads, so "is this a comment" cannot mean two things) is what
 * separates this from a runtime path: a fixture directory built with `path.resolve` sits on a
 * `code` line even though it's a string literal, so it is never scanned here — that path already
 * fails its own test if it goes stale, and this check would otherwise flag a live fixture path as
 * if it were a dead prose citation. The lookbehind excludes a URL's own `/docs/...` segment
 * (`https://socket.io/docs/v4/...`): preceded by another path or domain segment, never a citation
 * into this repo.
 */
const SOURCE_DOC_PATH = /(?<![\w./-])docs\/[\w.@-]+(?:\/[\w.@-]+)*\/?/g;
const PROMPT_SOURCES = [".claude/workflows/"];

test("every docs/ path a comment in tracked source, or a workflow prompt, names exists", () => {
  const broken: string[] = [];
  const sourceFiles = execSync('git ls-files "*.ts" "*.tsx" "*.mjs"', { encoding: "utf8" })
    .trim().split("\n").filter(Boolean)
    .filter((f) => !EXCLUDED_DIRS.some((dir) => f.startsWith(dir)))
    .filter((f) => f !== "tests/tooling/docReferences.test.ts");
  for (const file of sourceFiles) {
    const lines = classify(readFileSync(file, "utf8"));
    for (const line of lines) {
      if (line.kind !== "comment" && !PROMPT_SOURCES.some((dir) => file.startsWith(dir))) continue;
      for (const [raw] of line.text.matchAll(SOURCE_DOC_PATH)) {
        // Trailing sentence punctuation ("...checks.md.") is not part of the path; a bare
        // fragment ("docs/" alone, or a path a line-wrap cut mid-word, with no `.` in its last
        // segment and no trailing `/`) is not one this check can resolve either way, so it is
        // skipped rather than guessed at.
        const target = raw.replace(/\.$/, "");
        const last = target.replace(/\/$/, "").split("/").pop()!;
        if (!target.endsWith("/") && !last.includes(".")) continue;
        if (!existsSync(normalize(target.replace(/\/$/, "")))) broken.push(`${file} -> ${target}`);
      }
    }
  }
  assert.deepEqual(broken, []);
});
