// tests/e2e/offlineBannerFit.spec.ts — the offline banner's own band must
// hold whatever height its text needs, in every locale, at the narrowest
// supported width.
//
// #813 moved the banner's text to the large-text bar. Italian — the longest
// of the three strings — wraps to two lines at that size, and the band used
// to be a fixed 44px with `overflow` left at its RN default of `visible`:
// the second line rendered outside the coloured strip on every phone width
// rather than growing it to fit. No spec had ever driven OfflineBanner at
// all, which is how that went unseen through #813 landing.
//
// Only a browser can see it. `react-test-renderer` never runs flexbox, so no
// native test can say whether a wrapped line lands inside or outside its
// parent's box — tests/native/offlineBannerLargeText.test.tsx pins the font
// size and colour, not this.
import { test, expect } from "./fixtures";
import { openApp } from "./helpers/navigation";
import { PHONES } from "./helpers/phones";

const BANNER = '[data-testid="offline-banner"]';
const BANNER_TEXT = '[data-testid="offline-banner-text"]';

/** The narrowest portrait width any supported handset renders at (PHONES lists landscape logical sizes, so the short edge is a phone's portrait width). */
const NARROWEST_PORTRAIT_WIDTH = Math.min(...PHONES.map((p) => p.height));
const PORTRAIT_HEIGHT = 844;

/** Antialiasing/subpixel rounding, not a real overflow. */
const EPS = 1;

const LOCALES = ["en-US", "it-IT", "sq-AL"] as const;

test.describe("the offline banner's band holds its text at the narrowest width", () => {
  for (const locale of LOCALES) {
    test(locale, async ({ browser, baseURL }) => {
      const context = await browser.newContext({ locale });
      const page = await context.newPage();
      try {
        await page.setViewportSize({ width: NARROWEST_PORTRAIT_WIDTH, height: PORTRAIT_HEIGHT });
        await openApp(page, baseURL!);
        await context.setOffline(true);

        const text = page.locator(BANNER_TEXT);
        await expect(text).toBeVisible({ timeout: 15_000 });

        const bannerBox = (await page.locator(BANNER).boundingBox())!;
        const textBox = (await text.boundingBox())!;

        expect(
          textBox.y,
          `${locale}: text top (${textBox.y}) sits above the banner's own top (${bannerBox.y})`
        ).toBeGreaterThanOrEqual(bannerBox.y - EPS);
        expect(
          textBox.y + textBox.height,
          `${locale}: text bottom (${textBox.y + textBox.height}) spills past the banner's ` +
            `bottom (${bannerBox.y + bannerBox.height}) — the band did not grow to fit it`
        ).toBeLessThanOrEqual(bannerBox.y + bannerBox.height + EPS);

        await context.setOffline(false);
      } finally {
        await context.close();
      }
    });
  }
});
