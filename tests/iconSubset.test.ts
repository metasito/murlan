// tests/iconSubset.test.ts — the shipped icon subsets carry every glyph the app
// can render, and no icon name is built at runtime where the resolver cannot
// follow it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
// @ts-ignore -- .mjs helper shared with scripts/build-icon-fonts.mjs
import { analyzeIcons, analyzeSnippet, iconCharacters } from "../scripts/iconSubsetChars.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const glyphmapDir = path.join(
  repoRoot,
  "node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps"
);

interface Unresolved {
  file: string;
  line: number;
  family: string | null;
  expr: string;
}
interface Analysis {
  Ionicons: string[];
  Feather: string[];
  unresolved: Unresolved[];
}

test("every icon name the app uses exists in its family's glyphmap", () => {
  const names = analyzeIcons(repoRoot) as Analysis;
  for (const family of ["Ionicons", "Feather"] as const) {
    const glyphMap = JSON.parse(readFileSync(path.join(glyphmapDir, `${family}.json`), "utf8"));
    const unknown = names[family].filter((n) => glyphMap[n] === undefined);
    assert.deepEqual(unknown, [], `${family}: names not in its glyphmap — ${unknown.join(", ")}`);
  }
});

test("the subsets exist and are much smaller than the originals", () => {
  for (const family of ["Ionicons", "Feather"] as const) {
    const subset = path.join(repoRoot, "assets", "fonts", `${family}.subset.ttf`);
    assert.ok(existsSync(subset), `${subset} is missing — run node scripts/build-icon-fonts.mjs`);
    const original = path.join(
      repoRoot,
      "node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts",
      `${family}.ttf`
    );
    const ratio = statSync(subset).size / statSync(original).size;
    assert.ok(ratio < 0.5, `${family}.subset.ttf is ${Math.round(ratio * 100)}% of the original`);
  }
});

// One resolver, not two. scripts/iconSubsetChars.mjs's `resolveValues` is what
// both builds the manifest and answers this — the guard asks it "did you
// resolve this expression", rather than judging the expression's shape on its
// own, so the two cannot drift apart the way two independently written
// regexes already have (twice, on this exact file). A name assembled some
// other way — a template string, concatenation, a call the resolver cannot
// follow, a computed index used directly in the prop — renders as a blank box
// on the web with no error anywhere, which is what this refuses instead.
test("no icon name is built at runtime", () => {
  const { unresolved } = analyzeIcons(repoRoot) as Analysis;
  assert.deepEqual(
    unresolved,
    [],
    `icon names the resolver cannot follow:\n${unresolved
      .map((u) =>
        u.family === null
          ? `${u.file}:${u.line}: ${u.expr} — an @expo/vector-icons import with no subset behind it`
          : `${u.file}:${u.line}: <${u.family} name={${u.expr}}>`
      )
      .join("\n")}`
  );
});

// The guard is only worth having if it can fail. Synthetic snippets, not real
// files: they prove the rejection path is live without waiting for the next
// regression to prove it by accident.
test("the resolver rejects a ternary between two names it cannot trace", () => {
  const bad = analyzeSnippet(
    'import Ionicons from "@expo/vector-icons/Ionicons";\n' +
      "function X() { return <Ionicons name={cond ? a : b} />; }"
  ) as Analysis;
  assert.equal(bad.unresolved.length, 1, "a ternary between two free identifiers must not resolve");

  const good = analyzeSnippet(
    'import Ionicons from "@expo/vector-icons/Ionicons";\n' +
      'function X() { return <Ionicons name={cond ? "home" : "star"} />; }'
  ) as Analysis;
  assert.deepEqual(good.unresolved, []);
  assert.deepEqual(good.Ionicons, ["home", "star"]);
});

// metro.config.js swaps the subset in on the module specifier, so the glyphs an
// aliased import draws come from the subset whether or not the subset was built
// with them.
test("the family is the one imported, not the one the tag is spelled", () => {
  const aliased = analyzeSnippet(
    'import Ion from "@expo/vector-icons/Ionicons";\n' +
      'function X() { return <Ion name="pause" />; }'
  ) as Analysis;
  assert.deepEqual(aliased.Ionicons, ["pause"]);
  assert.deepEqual(aliased.unresolved, []);

  const unimported = analyzeSnippet('function X() { return <Ionicons name="pause" />; }') as Analysis;
  assert.deepEqual(unimported.Ionicons, [], "a tag bound to nothing is not this family");

  const otherFamily = analyzeSnippet(
    'import MaterialIcons from "@expo/vector-icons/MaterialIcons";\n' +
      'function X() { return <MaterialIcons name="home" />; }'
  ) as Analysis;
  assert.equal(
    otherFamily.unresolved.length,
    1,
    "a family with no subset behind it must be reported, not skipped"
  );
});

test("the characters the subsets were built from cover every name", () => {
  const chars = iconCharacters(repoRoot) as Record<string, string>;
  const manifest: Record<string, string> = JSON.parse(
    readFileSync(path.join(repoRoot, "scripts", "icon-subset.json"), "utf8")
  );
  for (const family of ["Ionicons", "Feather"] as const) {
    const have = new Set(manifest[family]);
    const missing = [...chars[family]].filter((c) => !have.has(c));
    assert.deepEqual(
      missing.map((c) => c.codePointAt(0)?.toString(16)),
      [],
      `${family}: the shipped subset was built without these codepoints — run node scripts/build-icon-fonts.mjs`
    );
  }
});
