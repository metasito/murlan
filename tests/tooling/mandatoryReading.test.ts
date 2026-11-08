// tests/tooling/mandatoryReading.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const bytes = (p: string) => statSync(path.join(root, p)).size;

// Raising either cap is a decision for the PR that does it, not something a test may compute:
// reference material belongs behind a pointer in a doc nobody is told to read first.
const TOTAL_CAP = 77_000;
const CHECKS_CAP = 9_000;
const CHECKS = "docs/agents/checks.md";

function pointerTargets(claudeMd: string): string[] {
  const section = /^## Where the rest lives\n([\s\S]*?)(?=^## )/m.exec(claudeMd)?.[1] ?? "";
  return [...new Set([...section.matchAll(/^- \*\*[^*]+\*\*[^`]*`([\w./-]+\.md)`/gm)].map((m) => m[1]))];
}

const targets = pointerTargets(read("CLAUDE.md"));
const mandatory = ["CLAUDE.md", ".claude/commands/queue.md", ...targets];

test("the pointer list is read from the section itself, one target per bullet", () => {
  const fixture = [
    "## Where the rest lives",
    "",
    "- **When x** — `a/one.md`: then `b/not-this.md`.",
    "- **Before y** — `two.md`: the index.",
    "",
    "## Next",
    "- **When z** — `outside.md`: not a pointer.",
    "",
  ].join("\n");
  assert.deepEqual(pointerTargets(fixture), ["a/one.md", "two.md"]);
  assert.deepEqual(pointerTargets("# no such section\n"), []);
});

test("CLAUDE.md still points at the docs a session reads first", () => {
  assert.ok(targets.length >= 7, targets.join(", "));
  for (const f of ["docs/agents/RULES.md", CHECKS, "docs/agents/issue-tracker.md", "CONTEXT.md"]) {
    assert.ok(targets.includes(f), `${f} is no longer a pointer target`);
  }
  for (const f of mandatory) assert.ok(existsSync(path.join(root, f)) && bytes(f) > 0, `${f} is missing or empty`);
});

test(`docs/agents/checks.md stays a router, at most ${CHECKS_CAP} bytes`, () => {
  const size = bytes(CHECKS);
  assert.ok(size <= CHECKS_CAP, `${CHECKS} is ${size} bytes`);
});

test(`the docs every session is pointed at first total at most ${TOTAL_CAP} bytes`, () => {
  const sizes = mandatory.map((f) => `${f} ${bytes(f)}`);
  const total = mandatory.reduce((n, f) => n + bytes(f), 0);
  assert.ok(total <= TOTAL_CAP, `${total} bytes (~${Math.round(total / 4)} tokens):\n${sizes.join("\n")}`);
});
