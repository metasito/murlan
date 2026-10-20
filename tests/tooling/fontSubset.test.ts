// tests/tooling/fontSubset.test.ts — the shipped WOFF2 subsets still cover every
// character the app can render.
//
// public/fonts/*.woff2 are built from an explicit character set
// (scripts/build-fonts.mjs) and committed, so a new string carrying a glyph
// they were not built with renders as tofu on the web and nowhere else — no
// error, no warning, in a language most of the player base reads. This is the
// only thing that says otherwise.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import subsetFont from "subset-font";
import { subsetCharacters, WEB_FONTS } from "../../scripts/fontSubsetChars.mjs";
import { cmapCodepoints } from "../helpers/cmap.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fontsDir = path.join(repoRoot, "public", "fonts");

const require = createRequire(import.meta.url);
const fonts = WEB_FONTS as { pkg: string; weight: string; family: string }[];

const manifest: { characters: string; files: string[] } = JSON.parse(
  readFileSync(path.join(repoRoot, "scripts", "font-subset.json"), "utf8")
);

/**
 * What a needed character the source face draws but `woff2` does not: those render as tofu, or in
 * the fallback face. A character the source face lacks falls back whatever the subset holds.
 */
async function tofu(font: (typeof fonts)[number], woff2: Buffer, needed: string): Promise<string[]> {
  const [source, shipped] = await Promise.all([
    cmapCodepoints(readFileSync(require.resolve(`${font.pkg}/${font.weight}/${font.family}.ttf`))),
    cmapCodepoints(woff2),
  ]);
  return [...needed].filter((ch) => source.has(ch.codePointAt(0)!) && !shipped.has(ch.codePointAt(0)!));
}

test("each shipped face draws every character the app can render that its source face draws", async () => {
  const needed = subsetCharacters(repoRoot) as string;
  for (const font of fonts) {
    const missing = await tofu(font, readFileSync(path.join(fontsDir, `${font.family}.woff2`)), needed);
    assert.deepEqual(missing, [], `run \`node scripts/build-fonts.mjs\` — ${font.family}.woff2 has no glyph for ${JSON.stringify(missing.join(""))}`);
  }
});

test("a face subset without one needed glyph is caught", async () => {
  const needed = subsetCharacters(repoRoot) as string;
  const [font] = fonts;
  const dropped = "ë";
  assert.ok(needed.includes(dropped), `the app no longer renders ${dropped}; plant another character`);
  const dir = mkdtempSync(path.join(tmpdir(), "font-subset-"));
  try {
    const ttf = readFileSync(require.resolve(`${font.pkg}/${font.weight}/${font.family}.ttf`));
    const planted = path.join(dir, `${font.family}.woff2`);
    writeFileSync(planted, await subsetFont(ttf, needed.replace(dropped, ""), { targetFormat: "woff2" }));
    assert.deepEqual(await tofu(font, readFileSync(planted), needed), [dropped]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the manifest lists every character the app can render", () => {
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
