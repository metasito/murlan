// tests/tooling/testInvocationForm.test.ts
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const at = (file: string) => join(ROOT, file);
const scripts: Record<string, string> = JSON.parse(readFileSync(at("package.json"), "utf8")).scripts;

/** `node --test` (or `nodeTest.mjs --test`) followed by flags and a target that is a directory, not a file or a glob. */
const DIRECTORY_FORM = /(?:node|nodeTest\.mjs)\s+(?:--?[\w=./:-]+\s+)*--test\s+(?:--?[\w=./:-]+\s+)*["']?((?:[\w.-]+\/)+[\w.-]*)["']?(?=\s|$|`|\)|\\)/g;

function directoryForms(text: string): string[] {
  return [...text.matchAll(DIRECTORY_FORM)].map((m) => m[1]).filter((t) => !/\.(?:test\.)?[cm]?[jt]sx?$/.test(t) && !t.includes("*"));
}

test("no doc, script or workflow runs node --test on a directory, which fails on Node 22", () => {
  assert.deepEqual(directoryForms('node --test tests/tooling and node --test "tests/tooling/" and node --test --test-force-exit tests/tooling'), ["tests/tooling", "tests/tooling/", "tests/tooling"]);
  assert.deepEqual(directoryForms("node --test tests/a/b.test.ts node --test 'tests/**/*.test.ts'"), []);
  const files = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .trim().split("\n").filter((f) => /\.(md|yml|yaml|mjs|sh|json)$/.test(f) && existsSync(at(f)))
    .filter((f) => !f.startsWith(".claude/skills/") && !f.startsWith("docs/plans/") && !f.startsWith("docs/research/"));
  const found = files.flatMap((f) => directoryForms(readFileSync(at(f), "utf8")).map((t) => `${f} -> ${t}`));
  assert.deepEqual(found, []);
});

test("npm run test:tooling owns the one working form for the tooling suite", () => {
  const script = scripts["test:tooling"];
  assert.ok(script, "package.json has no test:tooling script");
  assert.match(script, /"tests\/tooling\/\*\*\/\*\.test\.ts"/);
  assert.match(readFileSync(at("docs/agents/checks.md"), "utf8"), /npm run test:tooling/);
});
