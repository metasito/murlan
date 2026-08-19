/**
 * The characters the web subsets have to carry, and the fonts that carry them.
 *
 * Shared by scripts/build-fonts.mjs and tests/fontSubset.test.ts so the set the
 * files were built from and the set the test demands are the same expression.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** The six weights app/_layout.tsx loads, pinned by tests/assetBarrels.test.ts. */
export const WEB_FONTS = [
  { pkg: "@expo-google-fonts/rajdhani", weight: "500Medium", family: "Rajdhani_500Medium" },
  { pkg: "@expo-google-fonts/rajdhani", weight: "600SemiBold", family: "Rajdhani_600SemiBold" },
  { pkg: "@expo-google-fonts/rajdhani", weight: "700Bold", family: "Rajdhani_700Bold" },
  { pkg: "@expo-google-fonts/inter", weight: "400Regular", family: "Inter_400Regular" },
  { pkg: "@expo-google-fonts/inter", weight: "500Medium", family: "Inter_500Medium" },
  { pkg: "@expo-google-fonts/inter", weight: "600SemiBold", family: "Inter_600SemiBold" },
];

/**
 * Where user-visible text can come from. The three catalogues are where nearly
 * all of it lives; the screens are scanned too because a literal outside `t()`
 * — a glyph, a separator, a marker — renders just the same, and a missing one
 * is silent tofu rather than an error.
 */
const TEXT_SOURCES = ["locales", "app", "components", "lib"];

/**
 * Printable ASCII covers usernames (the server allows [a-zA-Z0-9_] only),
 * six-character room codes, every card rank and every number the app formats.
 * Everything beyond it — Italian accents, Albanian ë and ç, the suit glyphs,
 * typographic dashes — comes from the strings themselves.
 */
function printableAscii() {
  let out = "";
  for (let code = 0x20; code <= 0x7e; code++) out += String.fromCodePoint(code);
  return out;
}

export function subsetCharacters(root) {
  const set = new Set(printableAscii());
  for (const dir of TEXT_SOURCES) {
    const base = path.join(root, dir);
    for (const name of readdirSync(base, { recursive: true, encoding: "utf8" })) {
      if (!name.endsWith(".ts") && !name.endsWith(".tsx")) continue;
      // The whole file, not just the string literals: identifiers are ASCII,
      // which is already in, so reading the source needs no parser and can
      // only overshoot.
      for (const ch of readFileSync(path.join(base, name), "utf8")) set.add(ch);
    }
  }
  // Whitespace a font has no glyph for.
  for (const ws of ["\n", "\r", "\t"]) set.delete(ws);
  return [...set].sort().join("");
}
