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

/**
 * Packages whose published source Playwright's transform cannot parse — matched on the
 * package name rather than the whole specifier, because `expo/fetch` and
 * `@react-native-async-storage/async-storage` are both real imports in `lib/` and both
 * carry the same problem as a bare `react-native`.
 */
const UNRUNNABLE = /^(@react-native[\w-]*\/|react-native(\/|-|$)|@expo\/|expo(\/|-|$))/;

/** Aliases `tsconfig.json` declares. A specifier under one of these is a module here. */
const ALIASES: [string, string][] = [
  ["@shared/", path.join(repoRoot, "shared")],
  ["@/", repoRoot],
];

/** `import type` and `export type` are erased before anything is loaded. */
const PATTERNS = [
  /^\s*(?:import|export)\s+(?!type\s)[^;]*?from\s*["']([^"']+)["']/gm,
  /^\s*import\s+["']([^"']+)["']/gm,
  /\b(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/g,
];

function specifiers(file: string): string[] {
  const source = blankComments(readFileSync(file, "utf8"));
  const out: string[] = [];
  for (const re of PATTERNS) {
    re.lastIndex = 0;
    for (let m = re.exec(source); m; m = re.exec(source)) out.push(m[1]);
  }
  return out;
}

/** Every spelling of one module on disk, longest-lived first. */
const EXTENSIONS = ["", ".ts", ".tsx", ".web.ts", ".web.tsx", ".js", ".mjs"];

function local(from: string, specifier: string): string | null {
  for (const [prefix, root] of ALIASES) {
    if (specifier.startsWith(prefix)) return path.join(root, specifier.slice(prefix.length));
  }
  return specifier.startsWith(".") ? path.resolve(path.dirname(from), specifier) : null;
}

/**
 * The file a specifier names. A local specifier that resolves to nothing throws rather than
 * being taken for a package: skipping it would leave everything behind it unscanned and
 * report the sweep clean, which is the one way this guard could be quietly wrong.
 */
function resolve(from: string, specifier: string): string | null {
  const base = local(from, specifier);
  if (base === null) return null;
  for (const ext of EXTENSIONS) {
    for (const candidate of [`${base}${ext}`, path.join(base, `index${ext || ".ts"}`)]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
  }
  throw new Error(
    `${path.relative(repoRoot, from)} imports "${specifier}", which names a module in this ` +
      `repo and resolves to no file. Teach \`EXTENSIONS\`/\`ALIASES\` how to find it — left ` +
      `unresolved, everything it imports goes unscanned and this sweep passes on nothing.`
  );
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
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  walk(E2E);
  return out;
}

test("the walk follows imports through app modules to reach an unparsable package", () => {
  // `lib/socket.ts` imports no package this scan names; it gets there through `@/lib/query-client`
  // and `expo/fetch`. Re-point this at another transitive reacher if that stops being true —
  // never at one importing `react-native` itself, which proves only that the regex runs.
  const chain = unrunnableChain(path.join(repoRoot, "lib", "socket.ts"));
  assert.ok(
    chain && UNRUNNABLE.test(chain[chain.length - 1]) && chain.length > 2,
    `walking \`lib/socket.ts\` found ${chain ? `a direct import: ${chain.join(" → ")}` : "nothing"}. ` +
      "Recursion and resolution are what this scan is, and both are unproven if the only chain " +
      "it can find is one file long"
  );
});

test("a local specifier that resolves to nothing is an error, not a package", () => {
  assert.throws(
    () => resolve(path.join(repoRoot, "lib", "socket.ts"), "@/lib/nothingIsHere"),
    /resolves to no file/,
    "an unresolvable local import was taken for a package, so everything behind it goes " +
      "unscanned and the sweep reports clean on a subtree it never read"
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
