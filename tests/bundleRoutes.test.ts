// tests/bundleRoutes.test.ts — the guard that names an empty route table.
//
// The defect it exists for cannot be reproduced here: it needs two checkouts of
// this repo exporting against one machine-wide Metro cache. What this file pins
// is that the guard reads `app/` rather than a list, and that it actually fails
// on a bundle with no routes — a guard that only ever passes is the failure
// mode, not the export.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expectedRouteKeys, missingRoutes } from "../scripts/bundleRoutes.mjs";

function fakeAppDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "murlan-routes-"));
  mkdirSync(path.join(dir, "(online)"));
  for (const f of ["_layout.tsx", "lobby.tsx", "+not-found.tsx", "+native-intent.tsx", "readme.md"]) {
    writeFileSync(path.join(dir, f), "");
  }
  writeFileSync(path.join(dir, "(online)", "room.tsx"), "");
  return dir;
}

describe("the exported bundle carries this checkout's routes", () => {
  test("the expected keys come from app/, nested groups included", () => {
    assert.deepEqual(expectedRouteKeys(fakeAppDir()).sort(), [
      "./(online)/room.tsx",
      "./+not-found.tsx",
      "./_layout.tsx",
      "./lobby.tsx",
    ]);
  });

  test("the shapes expo-router's own context excludes are not required", () => {
    const keys = expectedRouteKeys(fakeAppDir());
    assert.ok(!keys.includes("./+native-intent.tsx"), "+native-intent is source, never a route");
    assert.ok(!keys.some((k) => k.endsWith(".md")), "only .ts/.tsx files become routes");
  });

  test("a bundle carrying every key is accepted", () => {
    const dir = fakeAppDir();
    const bundle = expectedRouteKeys(dir).map((k) => JSON.stringify(k)).join(",");
    assert.deepEqual(missingRoutes(bundle, dir), []);
  });

  // The floor. This is the bundle the bug actually produces: `_layout` present,
  // routes gone. A guard that passed on this would catch nothing.
  test("a bundle with _layout and no routes is reported, key by key", () => {
    const dir = fakeAppDir();
    const missing = missingRoutes('__d(function(){"_layout"})', dir);
    assert.deepEqual(missing, expectedRouteKeys(dir));
  });
});

/** `metro.config.js`'s own `cacheVersion`, read under a given environment. */
function cacheVersionWith(env: Record<string, string | undefined>): string {
  return execFileSync(
    process.execPath,
    ["-e", "process.stdout.write(require('./metro.config.js').cacheVersion)"],
    { cwd: path.resolve(import.meta.dirname, ".."), env: { ...process.env, ...env }, encoding: "utf8" }
  );
}

describe("Metro's transform cache key covers what the transform depends on", () => {
  test("the project root, so two checkouts do not share entries", () => {
    assert.ok(
      cacheVersionWith({}).includes(path.resolve(import.meta.dirname, "..")),
      "two checkouts of this repo would overwrite each other's cached transforms"
    );
  });

  // babel-preset-expo replaces `process.env.EXPO_PUBLIC_*` with a literal in a production
  // build, so the value is part of the cached output. A build that sets one differently must
  // not read back a transform made under the other — which is how an e2e export and a
  // production build come to serve each other's code.
  test("every EXPO_PUBLIC_ value babel inlines", () => {
    const off = cacheVersionWith({ EXPO_PUBLIC_E2E_FAST: undefined });
    const on = cacheVersionWith({ EXPO_PUBLIC_E2E_FAST: "1" });
    assert.notEqual(on, off, "a zero-delay e2e build shares cache entries with a real one");
    assert.ok(on.includes("EXPO_PUBLIC_E2E_FAST=1"));
  });
});

/**
 * Metro's `FileStore` lives under the OS temp directory, so a project-relative
 * path names nothing — and `fs.globSync` returns `[]` for a path that does not
 * exist rather than throwing, so nothing says so.
 *
 * Nothing here needs to clear that cache; the key above keeps checkouts and
 * environments apart per entry instead. This is so the next attempt to clear
 * it is not written blind.
 */
describe("the cache paths that shipped do not come back", () => {
  /**
   * A pin on two literals, not a general guard: a path assembled by `path.join`
   * from separate segments, or concatenated, goes straight past it. Widening it
   * to catch those means matching any mention of Metro and a cache in one file,
   * which fires on this test and on every doc that explains the rule.
   */
  const SHIPPED = /["'`][^"'`\n]*(?:\.metro-cache|\.cache[/\\]+metro)/;

  /** Everywhere a cache clear could plausibly be written. */
  function scanned(): { name: string; source: string }[] {
    const root = path.resolve(import.meta.dirname, "..");
    const trees = ["scripts", "lib", path.join(".github", "workflows")];
    const files = trees.flatMap((tree) => {
      const dir = path.join(root, tree);
      if (!existsSync(dir)) return [];
      return readdirSync(dir, { recursive: true, encoding: "utf8" })
        .filter((f) => /\.(js|mjs|ts|tsx|ya?ml)$/.test(f))
        .map((f) => ({
          name: path.join(tree, f).replaceAll(path.sep, "/"),
          source: readFileSync(path.join(dir, f), "utf8"),
        }));
    });
    const top = ["metro.config.js", "babel.config.js", "package.json", ".replit"]
      .filter((f) => existsSync(path.join(root, f)))
      .map((f) => ({ name: f, source: readFileSync(path.join(root, f), "utf8") }));
    return [...files, ...top];
  }

  test("the pattern matches the shapes it is for", () => {
    // The floor. The first two are what shipped; the third is the Windows
    // spelling, where the source's doubled separator eats a single `[/\\]`.
    assert.ok(SHIPPED.test(`fs.globSync(".metro-cache")`));
    assert.ok(SHIPPED.test(`fs.globSync("node_modules/.cache/metro")`));
    assert.ok(SHIPPED.test(`fs.rmSync("node_modules\\\\.cache\\\\metro")`));
    // Asking Metro where its own store is, which is the shape that cannot
    // drift, and which this must never refuse.
    assert.ok(!SHIPPED.test(`require("./metro.config.js").cacheStores[0].clear()`));
    // A mention several lines below an unrelated string is not a path.
    assert.ok(!SHIPPED.test(`const msg = "hello";\n\n// nothing touches .metro-cache`));
  });

  test("the scan reads the files it claims to", () => {
    // The other floor: a filter that matches nothing leaves `offenders` empty,
    // which is indistinguishable from a clean tree.
    assert.ok(scanned().length > 40, `only read ${scanned().length} files`);
  });

  test("none of them names one", () => {
    const offenders = scanned()
      .filter(({ source }) => SHIPPED.test(source))
      .map(({ name }) => name);
    assert.deepEqual(offenders, [], "these clear a Metro cache that is not there");
  });
});
