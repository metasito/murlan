// tests/iconSubset.test.ts — the shipped icon subsets carry every glyph the app
// can render, and no icon name is built at runtime where the resolver cannot
// follow it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
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

// Measured on this branch: Ionicons is 21,420 B of 389,724 B (5.5%), Feather
// 2,164 B of 55,596 B (3.9%). At roughly 280 B a glyph that leaves room for
// some sixty more Ionicons names, so adding icons does not trip it — but a
// subset that stopped subsetting, or a full face committed over one, does.
const MAX_SUBSET_RATIO = 0.1;

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
    assert.ok(
      ratio < MAX_SUBSET_RATIO,
      `${family}.subset.ttf is ${(ratio * 100).toFixed(1)}% of the original, over the ` +
        `${MAX_SUBSET_RATIO * 100}% ceiling`
    );
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

/**
 * The codepoints a TrueType file's `cmap` actually maps to a glyph.
 *
 * Format 4 is what subset-font emits for both faces and reaches the whole BMP,
 * where every icon codepoint lives; any other format throws rather than
 * returning the empty set, which would pass every caller by covering nothing.
 */
function cmapCodepoints(fontPath: string): Set<number> {
  const buf = readFileSync(fontPath);
  let cmap: number | null = null;
  for (let i = 0; i < buf.readUInt16BE(4); i++) {
    const entry = 12 + i * 16;
    if (buf.toString("ascii", entry, entry + 4) === "cmap") cmap = buf.readUInt32BE(entry + 8);
  }
  assert.ok(cmap !== null, `${fontPath}: no cmap table`);

  const covered = new Set<number>();
  for (let i = 0; i < buf.readUInt16BE(cmap + 2); i++) {
    const sub = cmap + buf.readUInt32BE(cmap + 4 + i * 8 + 4);
    const format = buf.readUInt16BE(sub);
    assert.equal(format, 4, `${fontPath}: cmap subtable format ${format} is not one this can read`);

    const segCount = buf.readUInt16BE(sub + 6) / 2;
    const endCodes = sub + 14;
    const startCodes = endCodes + segCount * 2 + 2;
    const idDeltas = startCodes + segCount * 2;
    const idRangeOffsets = idDeltas + segCount * 2;
    for (let seg = 0; seg < segCount; seg++) {
      const end = buf.readUInt16BE(endCodes + seg * 2);
      const start = buf.readUInt16BE(startCodes + seg * 2);
      const delta = buf.readInt16BE(idDeltas + seg * 2);
      const rangeOffsetAt = idRangeOffsets + seg * 2;
      const rangeOffset = buf.readUInt16BE(rangeOffsetAt);
      for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
        let glyph = (cp + delta) & 0xffff;
        if (rangeOffset !== 0) {
          glyph = buf.readUInt16BE(rangeOffsetAt + rangeOffset + (cp - start) * 2);
          if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
        }
        if (glyph !== 0) covered.add(cp);
      }
    }
  }
  return covered;
}

test("the shipped subsets carry a glyph for every name the app renders", () => {
  const chars = iconCharacters(repoRoot) as Record<string, string>;
  for (const family of ["Ionicons", "Feather"] as const) {
    const wanted = [...chars[family]].map((c) => c.codePointAt(0) as number);
    assert.ok(wanted.length > 0, `${family}: the source scan found no icon characters at all`);

    const covered = cmapCodepoints(path.join(repoRoot, "assets", "fonts", `${family}.subset.ttf`));
    const missing = wanted.filter((cp) => !covered.has(cp)).map((cp) => cp.toString(16));
    assert.deepEqual(
      missing,
      [],
      `${family}.subset.ttf carries no glyph for U+${missing.join(", U+")} — ` +
        `run node scripts/build-icon-fonts.mjs`
    );
  }
});
