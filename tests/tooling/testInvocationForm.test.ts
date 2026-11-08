// tests/tooling/testInvocationForm.test.ts
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const at = (file: string) => join(ROOT, file);
const CHECKS = "docs/agents/checks.md";
const scripts: Record<string, string> = JSON.parse(readFileSync(at("package.json"), "utf8")).scripts;

const VALUE_FLAGS = new Set(["--import", "--require", "--test-reporter", "--test-reporter-destination", "--test-timeout", "--test-concurrency", "--test-name-pattern", "--test-shard"]);

/** The targets of every `node --test` / `nodeTest.mjs --test` command in `text`, continuation lines joined, that are neither a file nor a glob. */
function directoryForms(text: string): string[] {
  const found: string[] = [];
  for (const m of text.replace(/\\\r?\n/g, " ").matchAll(/(?:\bnode|nodeTest\.mjs)\b[^\n]*?\s--test(?![\w-])([^\n]*)/g)) {
    const tokens = m[1].split(/\s*(?:&&|\|\||[|;`)])/)[0].trim().split(/\s+/).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i].replace(/^["']|["']$/g, "");
      if (t.startsWith("-")) {
        if (VALUE_FLAGS.has(t)) i++;
        continue;
      }
      const pathLike = /^(?:\.{0,2}\/)?[\w.-]+(?:\/[\w.-]*)*$/.test(t) && (t.includes("/") || t === "tests" || t === ".");
      if (pathLike && !/\.[cm]?[jt]sx?$/.test(t)) found.push(t);
    }
  }
  return found;
}

// A dated plan is a record of the commands its day used; rewriting them would falsify it
// (the same exclusion as docReferences.test.ts).
const DATED_PLAN = /^docs\/plans\/\d{4}-\d{2}-\d{2}-[^/]+\.md$/;

test("no doc, script or workflow runs node --test on a directory, which fails on Node 22", () => {
  const dirs = [
    "node --test tests/tooling",
    'node --test "tests/tooling/"',
    "node --test tests",
    "node --test --test-timeout=1 tests/tooling",
    "node --test --test-reporter spec tests/tooling",
    "node scripts/nodeTest.mjs --import ./x.mjs --test --test-reporter spec --test-reporter-destination stdout tests/tooling",
    "node --test \\\n  tests/tooling",
  ];
  for (const form of dirs) assert.equal(directoryForms(form).length, 1, form);
  for (const ok of ["node --test a/b.test.ts", "node --test 'tests/**/*.test.ts'", "node --test --test-reporter spec a/b.test.ts && ls tests", "node --version"]) {
    assert.deepEqual(directoryForms(ok), [], ok);
  }
  const files = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .trim().split("\n").filter((f) => /\.(md|yml|yaml|mjs|sh|json)$/.test(f) && existsSync(at(f)))
    .filter((f) => !f.startsWith(".claude/skills/") && !DATED_PLAN.test(f));
  assert.ok(files.length > 100, `read ${files.length} files: the tracked set is not being listed`);
  const found = files.flatMap((f) => directoryForms(readFileSync(at(f), "utf8")).map((t) => `${f} -> ${t}`));
  assert.deepEqual(found, []);
});

test("npm run test:tooling owns the one working form for the tooling suite", () => {
  const script = scripts["test:tooling"];
  assert.ok(script, "package.json has no test:tooling script");
  assert.equal(script, scripts.test.replace('"tests/**/*.test.ts"', '"tests/tooling/**/*.test.ts"'));
  assert.notEqual(script, scripts.test, "the glob swap matched nothing");
  assert.match(readFileSync(at(CHECKS), "utf8"), /npm run test:tooling/);
});
