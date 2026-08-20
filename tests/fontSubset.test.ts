// tests/fontSubset.test.ts — the shipped WOFF2 subsets still cover every
// character the app can render.
//
// public/fonts/*.woff2 are built from an explicit character set
// (scripts/build-fonts.mjs) and committed, so a new string carrying a glyph
// they were not built with renders as tofu on the web and nowhere else — no
// error, no warning, in a language most of the player base reads. This is the
// only thing that says otherwise.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { subsetCharacters, WEB_FONTS } from "../scripts/fontSubsetChars.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fontsDir = path.join(repoRoot, "public", "fonts");

const manifest: { characters: string; files: string[] } = JSON.parse(
  readFileSync(path.join(repoRoot, "scripts", "font-subset.json"), "utf8")
);

test("the subsets carry every character the app can render", () => {
  const needed = subsetCharacters(repoRoot) as string;
  const have = new Set(manifest.characters);
  const missing = [...needed].filter((ch) => !have.has(ch));
  assert.deepEqual(
    missing,
    [],
    `run \`node scripts/build-fonts.mjs\` — these render as tofu on web: ${JSON.stringify(missing.join(""))}`
  );
});

test("every weight the app loads is shipped and declared", () => {
  // Three things have to name the same six faces: the styles that draw with
  // them, the files, and the @font-face block. A weight missing from any of
  // them renders in the fallback face with no error anywhere.
  const families = (WEB_FONTS as { family: string }[]).map((f) => f.family);
  assert.deepEqual(manifest.files, families.map((f) => `${f}.woff2`));

  const shell = readFileSync(path.join(repoRoot, "public", "index.html"), "utf8");
  for (const family of families) {
    const at = path.join(fontsDir, `${family}.woff2`);
    assert.ok(existsSync(at), `${family}.woff2 is declared and not here`);
    assert.ok(statSync(at).size > 0, `${family}.woff2 is empty`);
    assert.ok(
      shell.includes(`font-family: "${family}"`) && shell.includes(`/fonts/${family}.woff2`),
      `public/index.html declares no @font-face for ${family}`
    );
    assert.ok(
      shell.includes(`"${family}",`) || shell.includes(`"${family}"]`),
      `public/index.html never asks for ${family}, so the first layout using it is laid out in the fallback face`
    );

  }
});

test("subsetting is what makes the web build small, not a rounding error", () => {
  // The number PERF-02 is about: the six TTFs are 2,123,508 B. A build that
  // stopped subsetting would pass both tests above and ship all of it.
  const total = manifest.files.reduce((sum, f) => sum + statSync(path.join(fontsDir, f)).size, 0);
  const BUDGET = 300_000;
  assert.ok(total < BUDGET, `${total} B of web fonts, over the ${BUDGET} B budget`);
});
