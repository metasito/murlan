// Whether the icon fonts actually loaded in the browser cover every glyph
// this screen renders — the check static analysis cannot do, because
// scripts/iconSubsetChars.mjs can only say which names the source asks for,
// never whether the shipped assets/fonts/*.subset.ttf still carries the
// glyph for one of them. A missing glyph draws its font's .notdef box, which
// has no DOM signal, no console warning, nothing an accessibility tree
// exposes — the only difference from a real glyph is what gets drawn.
//
// U+FFFE is a Unicode noncharacter: reserved by the standard to never be
// assigned to a glyph, in any font, ever — so measuring it always exercises
// exactly the fallback a genuinely missing codepoint in "ionicons"/"feather"
// would hit (both fonts are referenced with no CSS fallback list — see
// metro.config.js and expo-font's web loader — so a codepoint absent from
// the subset resolves however the browser handles an uncovered character in
// an otherwise-loaded, fallback-less font). Every real glyph in both subsets
// renders at a uniform advance width (one em, confirmed empirically for both
// families) that is never within a device pixel of that fallback's width, so
// the comparison does not depend on which specific codepoints happen to be
// present the day this was written.
import type { Page } from "@playwright/test";

const MISSING_PROBE_CODEPOINT = 0xfffe;
const ICON_FAMILIES = new Set(["ionicons", "feather"]);

export interface GlyphFailure {
  family: string;
  codepoint: string;
}

/**
 * Every codepoint currently rendered through the "ionicons"/"feather"
 * font-family in the live DOM whose advance width matches the
 * definitely-missing baseline — i.e. every glyph on screen right now that is
 * not actually in the loaded font.
 */
export async function findMissingGlyphs(page: Page): Promise<GlyphFailure[]> {
  return page.evaluate(
    ({ missingCp, families }) => {
      const fonts = (document as unknown as { fonts: FontFaceSet }).fonts;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;
      const SIZE = 100;
      const widthOf = (family: string, ch: string) => {
        ctx.font = `${SIZE}px ${family}`;
        return ctx.measureText(ch).width;
      };
      const missingWidth: Record<string, number> = {};
      for (const f of families) missingWidth[f] = widthOf(f, String.fromCodePoint(missingCp));

      const failures: { family: string; codepoint: string }[] = [];
      const seen = new Set<string>();
      for (const el of Array.from(document.querySelectorAll("*"))) {
        if (el.childElementCount !== 0) continue;
        const primary = getComputedStyle(el)
          .fontFamily.split(",")[0]
          .replace(/["']/g, "")
          .trim()
          .toLowerCase();
        if (!families.includes(primary)) continue;
        const text = el.textContent ?? "";
        for (const ch of text) {
          const cp = ch.codePointAt(0);
          if (cp === undefined) continue;
          const key = `${primary}:${cp}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const width = widthOf(primary, ch);
          if (Math.abs(width - missingWidth[primary]) < 0.5) {
            failures.push({ family: primary, codepoint: cp.toString(16) });
          }
        }
      }
      void fonts; // document.fonts.ready is awaited by the caller before this runs
      return failures;
    },
    { missingCp: MISSING_PROBE_CODEPOINT, families: [...ICON_FAMILIES] }
  );
}

/**
 * Fails naming the screen and codepoint if any icon glyph currently on
 * screen is not actually in the loaded font. Call after driving the page
 * into whatever state should be showing the icon — a glyph hidden behind an
 * interaction that was never triggered is exactly the gap this exists to
 * close.
 */
export async function assertAllGlyphsRender(page: Page, screenLabel: string): Promise<void> {
  await page.evaluate(async () => {
    await (document as unknown as { fonts: FontFaceSet }).fonts.ready;
  });
  const failures = await findMissingGlyphs(page);
  if (failures.length > 0) {
    const detail = failures.map((f) => `${f.family} U+${f.codepoint}`).join(", ");
    throw new Error(
      `${screenLabel}: rendered icon glyph(s) not in the loaded font — ${detail}. ` +
        `Run node scripts/build-icon-fonts.mjs if the name is legitimate.`
    );
  }
}
