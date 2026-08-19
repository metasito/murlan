// tests/e2e/webFonts.spec.ts — the web build's faces are the subsets, and the
// subsets can draw what the app says.
//
// PERF-02 step 3 replaces 2.1 MB of TTF with 99 KB of WOFF2 built from an
// explicit character set (scripts/build-fonts.mjs). Getting that set wrong
// ships tofu — a missing glyph draws in the fallback face with no error
// anywhere — and Albanian ë/ç and Italian à/è are exactly the characters a
// Latin-basic subset would drop. tests/fontSubset.test.ts pins the set against
// the source; only a browser can say the files honour it.
import { test, expect } from "./fixtures";
import { openApp } from "./helpers/navigation";

const FAMILIES = [
  "Rajdhani_500Medium",
  "Rajdhani_600SemiBold",
  "Rajdhani_700Bold",
  "Inter_400Regular",
  "Inter_500Medium",
  "Inter_600SemiBold",
];

/**
 * Characters a Latin-basic subset would drop and the source TTFs do carry, so
 * a fallback here is the subsetting having lost something.
 *
 * The suit and arrow glyphs the app also renders — ♠ ♥ → ★ — are deliberately
 * not in this list: measured against the original TTF, Rajdhani never had them
 * either, so they have always come from a system fallback.
 */
const BEYOND_ASCII = ["ë", "ç", "à", "è", "ù", "ò", "•", "—", "…"];

test("the app draws in the subsets, and they carry the accented characters", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(60_000);
  await openApp(page, baseURL!);

  const result = await page.evaluate(
    async ({ families, chars }) => {
      await document.fonts.ready;
      // A declared face is only fetched when text is first painted in it, so
      // the home screen has three of the six. Asking for each one is what says
      // the file behind it exists, downloads and parses.
      const loaded: string[] = [];
      for (const family of families) {
        const faces = await document.fonts.load(`32px "${family}"`);
        if (faces.length > 0 && faces.every((f) => f.status === "loaded")) loaded.push(family);
      }

      // A glyph the face lacks is drawn by the fallback instead, at the
      // fallback's advance width — so a width that matches the fallback
      // exactly is the tofu this measures for.
      const ctx = document.createElement("canvas").getContext("2d")!;
      const widthIn = (font: string, text: string) => {
        ctx.font = font;
        return ctx.measureText(text).width;
      };
      const fellBack: string[] = [];
      for (const family of families) {
        for (const ch of chars) {
          const withFace = widthIn(`32px "${family}", monospace`, ch);
          const fallback = widthIn("32px monospace", ch);
          if (Math.abs(withFace - fallback) < 0.01) fellBack.push(`${family}:${ch}`);
        }
      }
      return { loaded: [...loaded], fellBack };
    },
    { families: FAMILIES, chars: BEYOND_ASCII }
  );

  expect(result.loaded.sort(), "every declared face has to load").toEqual([...FAMILIES].sort());
  expect(
    result.fellBack,
    "these characters are not in the subset that was asked to draw them"
  ).toEqual([]);
});

test("no full TTF is fetched on a cold web load", async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  const fontRequests: { url: string; bytes: number }[] = [];
  page.on("response", async (res) => {
    if (!/\.(ttf|otf|woff2?)(\?|$)/i.test(res.url())) return;
    const len = Number(res.headers()["content-length"] ?? 0);
    fontRequests.push({ url: new URL(res.url()).pathname, bytes: len });
  });

  await openApp(page, baseURL!);
  await page.evaluate(() => document.fonts.ready);

  const textFaces = fontRequests.filter((r) => /Rajdhani|Inter/.test(r.url));
  expect(
    textFaces.filter((r) => r.url.endsWith(".ttf")),
    "the 2.1 MB of TTF is what this replaced"
  ).toEqual([]);
  expect(textFaces.length, "the six subsets are what gets fetched").toBeGreaterThan(0);
});
