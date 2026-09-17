import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blankComments } from "./helpers/sourceScan.ts";
import { trackedFiles } from "./helpers/trackedFiles.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWNER = "lib/storageKeys.ts";

const sources = (...pathspec: string[]): string[] =>
  trackedFiles(repoRoot, ...pathspec).filter((f) => /\.(ts|tsx|js|mjs|cjs)$/.test(f));

function storageKeyLiterals(files: [string, string][]): string[] {
  const hits: string[] = [];
  for (const [file, src] of files) {
    if (file === OWNER) continue;
    for (const m of src.matchAll(/["'`](@murlan_\w*|murlan_user|murlan\.locale)["'`]/g)) hits.push(`${file}: ${m[1]}`);
  }
  return hits;
}

const UPWARD = new Set(["context", "components", "app", "server"]);
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g;

function upwardImports(files: [string, string][]): string[] {
  const hits: string[] = [];
  for (const [file, src] of files) {
    for (const m of blankComments(src).matchAll(IMPORT)) {
      const spec = m[1];
      const target = spec.startsWith("@/")
        ? spec.slice(2)
        : spec.startsWith(".")
          ? path.posix.normalize(path.posix.join(path.posix.dirname(file), spec))
          : null;
      if (target && UPWARD.has(target.split("/")[0])) hits.push(`${file} -> ${spec}`);
    }
  }
  return hits;
}

const read = (files: string[]): [string, string][] =>
  files.map((f) => [f, readFileSync(path.join(repoRoot, f), "utf8")]);

test("every storage key literal lives in lib/storageKeys.ts", () => {
  const all = read(sources());
  assert.ok(all.some(([f]) => f.startsWith("tests/e2e/")), "the sweep reaches the browser specs");
  const owned = readFileSync(path.join(repoRoot, OWNER), "utf8");
  assert.ok(storageKeyLiterals([["lib/haptics.ts", owned]]).length >= 9, "the pattern matches every key the owner declares");
  assert.deepEqual(storageKeyLiterals(all), []);
});

test("lib/ and shared/ import nothing from context/, components/, app/ or server/", () => {
  const files = read(sources("lib", "shared"));
  assert.ok(files.length > 20, "the sweep reads lib/ and shared/");
  assert.deepEqual(upwardImports([["lib/x.ts", 'import type { A } from "../context/A.tsx";']]), ["lib/x.ts -> ../context/A.tsx"]);
  assert.deepEqual(upwardImports(files), []);
});
