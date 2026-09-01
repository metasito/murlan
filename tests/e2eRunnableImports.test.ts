// tests/e2eRunnableImports.test.ts — what a browser spec is allowed to import from the app.
//
// A spec runs in Playwright's own Node process, which transpiles TypeScript and nothing else.
// `react-native` ships Flow-annotated source, so the moment a spec reaches one — directly or
// through a chain of app modules — the shard dies while collecting, before a single test runs,
// and reports a parse error in a file the spec never mentions.
//
// Sharing a constant with the app is still right: the alternative is a second copy of a number
// that has to agree with the first. What it means is that the constant lives in a module the
// runner can load. `lib/tokens.ts` and the `*Model.ts` files exist for exactly that, which is
// why the specs already import from them and not from the components beside them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blankComments } from "./helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const E2E = path.join(repoRoot, "tests", "e2e");

/** Packages whose published source Playwright's transform cannot parse. */
const UNRUNNABLE = /^(react-native(-|$)|expo(-|$)|@expo\/)/;

/** `import type` and `export type` are erased before anything is loaded. */
const IMPORTS = /^\s*(?:import|export)\s+(?!type\s)[^;]*?from\s*["']([^"']+)["']/gm;
const BARE_IMPORTS = /^\s*import\s+["']([^"']+)["']/gm;

function specifiers(file: string): string[] {
  const source = blankComments(readFileSync(file, "utf8"));
  const out: string[] = [];
  for (const re of [IMPORTS, BARE_IMPORTS]) {
    re.lastIndex = 0;
    for (let m = re.exec(source); m; m = re.exec(source)) out.push(m[1]);
  }
  return out;
}

/** The file a specifier names, or null when it is a package rather than a module here. */
function resolve(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(repoRoot, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(from), specifier)
      : null;
  if (base === null) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * The chain from `entry` to the first module importing something the runner cannot parse,
 * as repo-relative paths, or null when every module it reaches is loadable.
 */
function unrunnableChain(entry: string): string[] | null {
  const seen = new Set<string>();
  const walk = (file: string, chain: string[]): string[] | null => {
    if (seen.has(file)) return null;
    seen.add(file);
    const here = [...chain, path.relative(repoRoot, file).split(path.sep).join("/")];
    const local: string[] = [];
    for (const specifier of specifiers(file)) {
      if (UNRUNNABLE.test(specifier)) return [...here, specifier];
      const target = resolve(file, specifier);
      if (target) local.push(target);
    }
    for (const target of local) {
      const found = walk(target, here);
      if (found) return found;
    }
    return null;
  };
  return walk(entry, []);
}

function e2eFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) out.push(full);
    }
  };
  walk(E2E);
  return out;
}

test("the walk finds an unparsable import through a chain of app modules", () => {
  const chain = unrunnableChain(path.join(repoRoot, "components", "NotificationBanner.tsx"));
  assert.ok(
    chain && UNRUNNABLE.test(chain[chain.length - 1]),
    "walking a React Native component reached nothing unparsable, so this scan cannot fail " +
      "for the reason it exists — fix the resolver before trusting the sweep below"
  );
});

test("every browser spec imports only what Playwright's runner can load", () => {
  const offenders: string[] = [];
  for (const file of e2eFiles()) {
    const chain = unrunnableChain(file);
    if (chain) offenders.push(chain.join(" → "));
  }
  assert.deepEqual(
    offenders,
    [],
    "these reach a package Playwright cannot parse, and the shard dies before any test runs:\n" +
      `  ${offenders.join("\n  ")}\n` +
      "Import the constant from a module with no React Native in its graph — `lib/tokens.ts` " +
      "or a `*Model.ts` — or move it into one."
  );
});
