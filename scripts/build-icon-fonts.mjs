/**
 * Rebuilds assets/fonts/{Ionicons,Feather}.subset.ttf and the manifest recording
 * what they were built from.
 *
 *   node scripts/build-icon-fonts.mjs
 *
 * @expo/vector-icons ships both faces whole — 389,724 B and 55,596 B — for the
 * few dozen glyphs this app draws. Committed rather than built on deploy, the
 * same way public/fonts/ and assets/sounds/ are, so Replit needs no extra
 * tooling. tests/iconSubset.test.ts fails if a new icon is used that the shipped
 * subsets were not built with.
 *
 * TTF out, not WOFF2: metro.config.js resolves the vendor .ttf specifier to
 * these, and @expo/vector-icons' own font loading expects a TTF.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import subsetFont from "subset-font";
import { iconCharacters, vectorIconsVendorDir } from "./iconSubsetChars.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = vectorIconsVendorDir("Fonts");
const OUT_DIR = path.join(ROOT, "assets", "fonts");

const chars = iconCharacters(ROOT);
mkdirSync(OUT_DIR, { recursive: true });

const manifest = {};
for (const family of ["Ionicons", "Feather"]) {
  const sourcePath = path.join(VENDOR, `${family}.ttf`);
  const subset = await subsetFont(readFileSync(sourcePath), chars[family], {
    targetFormat: "truetype",
  });
  const out = path.join(OUT_DIR, `${family}.subset.ttf`);
  writeFileSync(out, subset);
  manifest[family] = chars[family];
  const before = statSync(sourcePath).size;
  const after = statSync(out).size;
  console.log(
    `${family}: ${before} -> ${after} B (${Math.round((1 - after / before) * 100)}% smaller), ` +
      `${[...chars[family]].length} glyphs`
  );
}

writeFileSync(
  path.join(ROOT, "scripts", "icon-subset.json"),
  JSON.stringify(manifest, null, 2) + "\n"
);
