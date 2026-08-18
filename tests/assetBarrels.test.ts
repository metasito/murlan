// tests/assetBarrels.test.ts — some packages register their assets from the
// package root: `@expo/vector-icons`'s root module names one font file per
// icon family. Metro cannot drop an asset a reachable module registers, so a
// single named import from the root pulls every family's `.ttf` and every
// family's glyph map into the bundle. The per-family subpaths
// (`@expo/vector-icons/Ionicons`) are the documented public API and pull one.
//
// TypeScript cannot see the difference — both forms give the same component —
// and the cost shows up only in a build, which is why this is pinned here.
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
});
