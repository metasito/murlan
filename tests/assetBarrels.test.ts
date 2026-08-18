// tests/assetBarrels.test.ts — some packages register their assets from the
// package root: `@expo/vector-icons`'s root module names one font file per
// icon family, and each `@expo-google-fonts` root requires every weight and
// italic it ships. Metro cannot drop an asset a reachable module registers, so
// one named import from the root pulls all of them. The subpaths
// (`@expo/vector-icons/Ionicons`, `@expo-google-fonts/inter/400Regular`) are
// the documented public API and pull one each.
//
// TypeScript cannot see the difference — both forms give the same value — and
// the cost shows up only in a build, which is why this is pinned here.
//
// The font half is pinned as an equality in both directions: a weight loaded
// and never used is dead bytes, and a weight used but never loaded renders in
// the fallback face with no error anywhere.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Every .ts/.tsx under app/, components/, context/ and lib/, as [repoRelativePath, source]. */
function appSources(): [string, string][] {
  return ["app", "components", "context", "lib"].flatMap((dir) =>
    readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
      .map((f): [string, string] => [
        path.posix.join(dir, f.split(path.sep).join("/")),
        readFileSync(path.join(repoRoot, dir, f), "utf8"),
      ])
  );
}

/** The module specifier of every `import … from "…"` in `src`. */
function importedModules(src: string): string[] {
  return [...src.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]);
}

/** Every name imported from a `@expo-google-fonts/*` subpath, across the app. */
function loadedFontFamilies(): Set<string> {
  const out = new Set<string>();
  for (const [, src] of appSources()) {
    const IMPORT = /import\s*\{([^}]*)\}\s*from\s*["']@expo-google-fonts\/[^"']+["']/g;
    for (const m of src.matchAll(IMPORT)) {
      for (const name of m[1].split(",")) {
        const trimmed = name.trim();
        if (trimmed) out.add(trimmed);
      }
    }
  }
  return out;
}

/** Every family named by a `fontFamily: "…"` literal, across the app. */
function styledFontFamilies(): Set<string> {
  const out = new Set<string>();
  for (const [, src] of appSources()) {
    for (const m of src.matchAll(/fontFamily:\s*["']([^"']+)["']/g)) out.add(m[1]);
  }
  return out;
}

describe("asset barrels", () => {
  test("no file imports icons from the @expo/vector-icons root", () => {
    const offenders = appSources()
      .filter(([, src]) => importedModules(src).includes("@expo/vector-icons"))
      .map(([rel]) => rel);
    assert.deepEqual(
      offenders,
      [],
      `import from "@expo/vector-icons/<Family>" instead: ${offenders.join(", ")}`
    );
  });

  test("the icon families imported by subpath are the ones the app uses", () => {
    const families = new Set<string>();
    for (const [, src] of appSources()) {
      for (const spec of importedModules(src)) {
        const m = /^@expo\/vector-icons\/(.+)$/.exec(spec);
        if (m) families.add(m[1]);
      }
    }
    assert.deepEqual(
      [...families].sort(),
      ["Feather", "Ionicons"],
      "each family adds its whole .ttf and glyph map to the bundle — update this list deliberately"
    );
  });

  test("no file imports a font weight from a @expo-google-fonts root", () => {
    const offenders = appSources()
      .filter(([, src]) =>
        importedModules(src).some((m) => /^@expo-google-fonts\/[^/]+$/.test(m))
      )
      .map(([rel]) => rel);
    assert.deepEqual(
      offenders,
      [],
      `import from "@expo-google-fonts/<package>/<weight>" instead: ${offenders.join(", ")}`
    );
  });

  test("the font weights loaded are exactly the ones styles name", () => {
    assert.deepEqual([...loadedFontFamilies()].sort(), [...styledFontFamilies()].sort());
  });
});
