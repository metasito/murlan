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

// Exact, so a reworded bullet cannot swap one target for another and keep the count.
const EXPECTED_TARGETS = [
  "CONTEXT.md",
  "components/CLAUDE.md",
  "docs/adr/README.md",
  "docs/agents/RULES.md",
  CHECKS,
  "docs/agents/issue-tracker.md",
  "server/CLAUDE.md",
];

test("CLAUDE.md points at exactly the docs this cap was set for", () => {
  assert.deepEqual([...targets].sort(), [...EXPECTED_TARGETS].sort());
  for (const f of mandatory) assert.ok(existsSync(path.join(root, f)) && bytes(f) > 0, `${f} is missing or empty`);
});

// An always-read file that sends the reader on, unconditionally, to a file outside the set
// moves the bytes without removing them.
function sendsOutside(file: string, text: string, inSet: Set<string>): string[] {
  const unconditional = /\b(?:now|first|at once|immediately)\b|\bbefore (?:anything|starting|beginning|you (?:start|begin|do anything))\b/i;
  return [...text.matchAll(/(\b(?:always|must|first)\s+)?\b[Rr]ead\s+`([^`\s]+\.md)`([^.\n]*)/g)]
    .filter((m) => m[1] || unconditional.test(m[3]))
    .map((m) => m[2])
    .filter((p) => !inSet.has(p) && !inSet.has(path.posix.join(path.posix.dirname(file), p)))
    .map((p) => `${file} → ${p}`);
}

test("the dodge scan sees an unconditional send-on and lets a conditional one through", () => {
  const set = new Set(["CLAUDE.md", "docs/agents/RULES.md"]);
  assert.deepEqual(sendsOutside("CLAUDE.md", "Read `docs/big.md` now, then work.", set), ["CLAUDE.md → docs/big.md"]);
  assert.deepEqual(sendsOutside("CLAUDE.md", "You must read `docs/big.md`.", set), ["CLAUDE.md → docs/big.md"]);
  assert.deepEqual(sendsOutside("CLAUDE.md", "Read `docs/big.md` before anything else.", set), ["CLAUDE.md → docs/big.md"]);
  assert.deepEqual(sendsOutside("CLAUDE.md", "Read `docs/agents/RULES.md` now.", set), []);
  assert.deepEqual(sendsOutside("docs/agents/x.md", "Read `RULES.md` first.", set), []);
  assert.deepEqual(sendsOutside("CLAUDE.md", "Read `docs/big.md` when a shadow is wrong.", set), []);
});

test("no always-read file sends the reader, unconditionally, to a file outside the set", () => {
  const inSet = new Set(mandatory);
  assert.deepEqual(mandatory.flatMap((f) => sendsOutside(f, read(f), inSet)), []);
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
