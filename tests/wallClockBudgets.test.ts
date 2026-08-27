// tests/wallClockBudgets.test.ts — a test that times an operation and compares
// the result against a fixed number is measuring the runner, not the code. CI
// shares a two-core box, so the same green code crosses the line at random and
// reddens whichever branch happened to be in flight. The suite has had four of
// these (#433), each found by a failure on an unrelated change.
//
// Comparing one measurement against another is a different thing and stays
// allowed: tests/integration/auth.test.ts contrasts a rate-limited login's
// timing with a genuine one, and load moves both together.
//
// Structural, like tests/a11yProps.test.ts: the property is about how the
// source is written, so it is checked by reading it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SELF = "tests/wallClockBudgets.test.ts";

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.name === "node_modules") continue;
    if (entry.isDirectory()) out.push(...sourcesUnder(rel));
    else if (/\.tsx?$/.test(entry.name) && rel !== SELF) out.push(rel);
  }
  return out;
}

/** `const elapsedMs = Date.now() - started`, and the two other ways to spell it. */
const MEASUREMENT =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=[^;\n]*(?:Date\.now\(\)\s*-|performance\.now\(\)\s*-|process\.hrtime)/g;

/** A number, or the SCREAMING_CASE constant standing in for one. */
const FIXED = String.raw`(?:[\d_]+(?:\.\d+)?(?:e-?\d+)?|[A-Z][A-Z\d_]*)\b`;

function offendingLines(source: string): string[] {
  const measured = new Set(
    [...source.matchAll(MEASUREMENT)].map((m) => m[1])
  );
  if (measured.size === 0) return [];

  const names = [...measured].join("|");
  const compared = new RegExp(
    String.raw`\b(?:${names})\s*[<>]=?\s*${FIXED}` +
      String.raw`|expect\(\s*(?:${names})\s*\)[.\w]*\.toBeLess(?:Than|ThanOrEqual)\(\s*${FIXED}`
  );
  return source
    .split("\n")
    .map((line, i) => [i + 1, line] as const)
    .filter(([, line]) => compared.test(line))
    .map(([n, line]) => `${n}: ${line.trim()}`);
}

test("no test compares a measured duration against a fixed number", () => {
  const offenders: string[] = [];
  for (const rel of sourcesUnder("tests")) {
    for (const line of offendingLines(readFileSync(path.join(repoRoot, rel), "utf8"))) {
      offenders.push(`${rel}:${line}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these assert on how fast the machine ran, so a loaded runner fails them on code that is fine.\n` +
      `Assert the property the timing stood in for — a marker file, a work counter, a state count — ` +
      `and leave the clock to the test's own timeout:\n  ${offenders.join("\n  ")}`
  );
});

test("the scan sees the shapes that reached main", () => {
  const seeded = [
    `const elapsedMs = Date.now() - start;\nassert.ok(elapsedMs < 2000, "slow");`,
    `const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;\nassert.ok(elapsedMs < 50);`,
    `const elapsed = Date.now() - startedAt;\nassert.ok(elapsed < PROMPT_MS, "hung");`,
    `let took = performance.now() - t0;\nexpect(took).toBeLessThan(100);`,
  ];
  for (const source of seeded) {
    assert.equal(offendingLines(source).length > 0, true, `missed:\n${source}`);
  }

  const allowed = [
    `const limitedMs = performance.now() - t0;\nassert.ok(limitedMs > genuineAvg * 0.5);`,
    `if (Date.now() - lastChangeAt > stallMs) throw new Error("stalled");`,
    `const started = Date.now();\nassert.ok(frames > 30);`,
  ];
  for (const source of allowed) {
    assert.deepEqual(offendingLines(source), [], `false positive:\n${source}`);
  }
});
