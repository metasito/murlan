// Every `.web.ts(x)` twin is held to its native module's type by a `twins.check.ts` beside it,
// which tsc compiles. The list in each check file is kept by hand; this test is what keeps it whole.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROOTS = ["lib", "components"];
const CHECK_FILES = [path.join("lib", "device", "twins.check.ts"), path.join("components", "table", "twins.check.ts")];
const MIN_TWINS = 10;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = ROOTS.flatMap((r) => walk(path.join(repoRoot, r)));
const nativeOf = (web: string) => {
  const stem = web.replace(/\.web\.tsx?$/, "");
  return [`${stem}.ts`, `${stem}.tsx`].find((f) => existsSync(f));
};
const twins = files.filter((f) => /\.web\.tsx?$/.test(f) && nativeOf(f));

/** Absolute stems a check file imports and then uses, split by whether the import is type-only. */
function importsOf(checkFile: string): { values: Set<string>; types: Set<string> } {
  const src = readFileSync(checkFile, "utf8");
  const values = new Set<string>();
  const types = new Set<string>();
  for (const m of src.matchAll(/^import (type )?\* as (\w+) from "(\.[^"]+)";$/gm)) {
    const used = m[1] ? new RegExp(`typeof ${m[2]}\\b`) : new RegExp(`[[,]\\s*${m[2]}\\b`);
    if (used.test(src)) (m[1] ? types : values).add(path.resolve(path.dirname(checkFile), m[3]));
  }
  return { values, types };
}

test("every check file exists", () => {
  for (const f of CHECK_FILES) assert.ok(existsSync(path.join(repoRoot, f)), `${f} is missing`);
});

test(`at least ${MIN_TWINS} twins are found`, () => {
  assert.ok(twins.length >= MIN_TWINS, `found ${twins.length} twins: the scan reads less than the tree holds`);
});

test("every twin and its native module are imported by a check file", () => {
  const checks = CHECK_FILES.map((f) => path.join(repoRoot, f))
    .filter((f) => existsSync(f))
    .map(importsOf);
  const unlisted = twins.filter((web) => {
    const stem = web.replace(/\.web\.tsx?$/, "");
    return !checks.some((c) => c.values.has(`${stem}.web`) && c.types.has(stem));
  });
  assert.deepEqual(
    unlisted.map((f) => path.relative(repoRoot, f)),
    [],
    "add each to a twins.check.ts: `import type * as x` its native module, `import * as` the twin, and assign"
  );
});
