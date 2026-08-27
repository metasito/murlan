// tests/wallClockBudgets.test.ts — a test that times an operation and compares
// the result against a fixed number is measuring the runner, not the code. CI
// shares a two-core box, so the same green code crosses the line at random and
// reddens whichever branch happened to be in flight.
//
// Comparing one measurement against another is a different thing and stays
// allowed: tests/integration/auth.test.ts contrasts a rate-limited login's
// timing with a genuine one, and load moves both together. So is a deadline
// that only fails a hung test — a `timeout`, a `setTimeout` reject — because
// nothing asserts against it.
//
// Structural, like tests/a11yProps.test.ts: the property is about how the
// source is written, so it is checked by reading it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blankCommentsAndStrings } from "./helpers/sourceScan.ts";

const selfPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(selfPath), "..");
const SELF = path.relative(repoRoot, selfPath).replace(/\\/g, "/");

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

const CLOCK = String.raw`(?:Date\.now\(\)|performance\.now\(\)|process\.hrtime(?:\.bigint)?\(\))`;
/** Anything holding a clock reading: both `const t0 = Date.now()` and the delta off it. */
const READING = new RegExp(
  String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=[^;\n]*${CLOCK}`,
  "g"
);
/**
 * A number or the SCREAMING_CASE constant standing in for one. `0` and `1` are
 * excluded: `elapsed > 0` bounds nothing, it just proves the clock was read.
 */
const FIXED = String.raw`(?:(?!0\b|1\b)[\d_]+(?:\.\d+)?(?:e-?\d+)?|[A-Z][A-Z\d_]*)\b`;
const COMPARE = String.raw`\s*[<>]=?\s*`;

/** The source of each `assert…(…)` / `expect(…)…` call, to its closing paren. */
function assertionExtents(source: string): { at: number; text: string }[] {
  const out: { at: number; text: string }[] = [];
  const opener = /\b(?:assert(?:\.\w+)*|expect)\s*\(/g;
  for (let m = opener.exec(source); m; m = opener.exec(source)) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < source.length; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")" && --depth === 0) break;
    }
    // Past the closing paren for `expect(x).toBeLessThan(n)`, stopping at the
    // statement's end so the next statement cannot be read as part of this one.
    const tail = source.slice(i, source.indexOf(";", i) + 1 || source.length);
    out.push({ at: m.index, text: source.slice(m.index, i) + tail });
    opener.lastIndex = i;
  }
  return out;
}

function offendingLines(rawSource: string): string[] {
  const source = blankCommentsAndStrings(rawSource);
  const readings = [...source.matchAll(READING)].map((m) => m[1]);
  const held = readings.length ? String.raw`|\b(?:${readings.join("|")})\b` : "";
  const measured = String.raw`(?:${CLOCK}${held})`;

  const banned = new RegExp(
    // `elapsedMs < 50`, and the subtraction spelled out: `end - start < 2000`.
    String.raw`${measured}(?:\s*-\s*[\w.$()]+)?${COMPARE}${FIXED}` +
      String.raw`|[\w.$()]+\s*-\s*${measured}${COMPARE}${FIXED}` +
      String.raw`|\.toBe(?:Less|Greater)Than(?:OrEqual)?\(\s*${FIXED}`
  );

  const lineOf = (index: number) => rawSource.slice(0, index).split("\n").length;
  const offenders: string[] = [];
  for (const { at, text } of assertionExtents(source)) {
    if (!banned.test(text)) continue;
    // `.toBeLessThan(50)` alone is only a budget when what it measures is one.
    if (!new RegExp(measured).test(text)) continue;
    const n = lineOf(at);
    offenders.push(`${n}: ${rawSource.split("\n")[n - 1].trim()}`);
  }
  return offenders;
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

test("the scan sees every way the comparison can be spelled", () => {
  const banned = [
    `const elapsedMs = Date.now() - start;\nassert.ok(elapsedMs < 2000, "slow");`,
    `const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;\nassert.ok(elapsedMs < 50);`,
    `const elapsed = Date.now() - startedAt;\nassert.ok(\n  elapsed < PROMPT_MS,\n  "hung"\n);`,
    `const t0 = performance.now();\nexpect(performance.now() - t0).toBeLessThan(100);`,
    `const start = Date.now();\nassert.ok(Date.now() - start < 2000, "slow");`,
    `const start = Date.now();\nconst end = Date.now();\nassert.ok(end - start < 2000);`,
    `let took = performance.now() - t0;\nexpect(took).toBeLessThanOrEqual(100);`,
  ];
  for (const source of banned) {
    assert.ok(offendingLines(source).length > 0, `missed:\n${source}`);
  }

  const allowed = [
    `const limitedMs = performance.now() - t0;\nassert.ok(limitedMs > genuineAvg * 0.5);`,
    `const elapsedMs = Date.now() - t0;\nassert.ok(elapsedMs > 0, "the clock was never read");`,
    `const elapsedMs = Date.now() - t0;\nif (elapsedMs > 100) retry();`,
    `const started = Date.now();\nassert.ok(frames > 30);`,
    `const deadline = Date.now() + 5000;\nawait waitFor(socket, "x", 5000);`,
  ];
  for (const source of allowed) {
    assert.deepEqual(offendingLines(source), [], `false positive:\n${source}`);
  }
});
