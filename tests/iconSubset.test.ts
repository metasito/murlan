// tests/iconSubset.test.ts — the shipped icon subsets carry every glyph the app
// can render, and no icon name is built at runtime where the scan cannot see it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
// @ts-ignore -- .mjs helper shared with scripts/build-icon-fonts.mjs
import { iconNames, iconCharacters } from "../scripts/iconSubsetChars.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const glyphmapDir = path.join(
  repoRoot,
  "node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps"
);

test("every icon name the app uses exists in its family's glyphmap", () => {
  const names = iconNames(repoRoot) as { Ionicons: string[]; Feather: string[] };
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

// The scan reads literals — a direct `name="x"`, both branches of a `name={}`
// ternary at any nesting depth, an `icon: "x"`/`icon="x"` table entry, and one
// `const`/`let` hop from an icon-named binding (see scripts/iconSubsetChars.mjs).
// A name assembled some other way — a template string, concatenation, a call,
// a computed index written directly in the prop — is invisible to all of that
// and would render as a blank box on the web with no error anywhere.
test("no icon name is built at runtime", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e)) files.push(p);
    }
  };
  for (const d of ["app", "components", "lib", "context"]) walk(path.join(repoRoot, d));

  const offenders: string[] = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/<(Ionicons|Feather)\b[^>]*?\bname=\{([^}]+)\}/gs)) {
      const expr = m[2].trim();
      // A trailing TS `as <Type>` cast carries no runtime weight — it is
      // stripped before judging the expression underneath it.
      const stripped = expr.replace(/\s+as\s+[\s\S]+$/, "").trim();
      const identifierOrMember = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(stripped);
      // A ternary — including one nested in either branch — is resolvable as
      // long as it contains none of the constructs a static scan cannot
      // follow: a template literal, string concatenation, a function call, or
      // a computed index. Whatever literal branches it has, the scan above
      // already finds by the same `?`/`:` shape.
      const hasDangerousConstruct = /[`+[\]]/.test(stripped) || /[A-Za-z0-9_$]\(/.test(stripped);
      const literalTernary = !hasDangerousConstruct && stripped.includes("?") && stripped.includes(":");
      const resolvable = identifierOrMember || literalTernary;
      if (!resolvable) offenders.push(`${path.relative(repoRoot, file)}: name={${expr}}`);
    }
  }
  assert.deepEqual(offenders, [], `icon names the subset scan cannot see:\n${offenders.join("\n")}`);
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
