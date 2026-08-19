/**
 * Rebuilds public/fonts/ — the WOFF2 subsets the web build serves.
 *
 *   node scripts/build-fonts.mjs
 *
 * `@expo-google-fonts/*` ships TTF only, and the six weights the app uses are
 * 2,123,508 bytes of it. Every one carries the full Latin-Extended coverage
 * Google publishes; the app renders three locales and usernames the server
 * limits to [a-zA-Z0-9_] (RegisterSchema, server/schemas.ts), so most of that
 * is glyphs nothing can ever ask for.
 *
 * Subsetting runs here rather than in the build so a Replit deploy needs no
 * extra tooling: the output is committed, exactly as assets/sounds/ is, and
 * tests/fontSubset.test.ts fails if the locales grow a character the shipped
 * subsets do not carry.
 *
 * harfbuzzjs via subset-font — WASM, no native build step.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import subsetFont from "subset-font";
import { subsetCharacters, WEB_FONTS } from "./fontSubsetChars.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "public", "fonts");

const chars = subsetCharacters(ROOT);
mkdirSync(OUT_DIR, { recursive: true });

let before = 0;
let after = 0;

for (const font of WEB_FONTS) {
  const source = path.join(ROOT, "node_modules", font.pkg, font.weight, `${font.family}.ttf`);
  const ttf = readFileSync(source);
  const woff2 = await subsetFont(ttf, chars, { targetFormat: "woff2" });
  writeFileSync(path.join(OUT_DIR, `${font.family}.woff2`), woff2);
  before += ttf.length;
  after += woff2.length;
  console.log(
    `${font.family}: ${ttf.length} B TTF -> ${woff2.length} B WOFF2`
  );
}

// Beside this script rather than in public/, which is served verbatim.
writeFileSync(
  path.join(ROOT, "scripts", "font-subset.json"),
  `${JSON.stringify({ characters: chars, files: WEB_FONTS.map((f) => `${f.family}.woff2`) }, null, 2)}\n`
);

console.log(`\n${before} B -> ${after} B (${chars.length} characters)`);
