// tests/e2e/bannerDisplaces.spec.ts — a banner must not sit on top of a control.
//
// A notification is an interruption, not a lid: the audit found a rate-limit
// banner on the online hub covering the mode selector outright, which is the
// one thing the player opened that screen to use. This asserts the general
// shape rather than that one case — no visible control's box may intersect the
// banner's box — so the next screen that lets a banner swallow a control fails
// here.
//
// Only a browser can answer it. `react-test-renderer` never runs flexbox, so a
// native test can assert the banner's declared `top` and learn nothing about
// what is underneath it.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openApp, registerNewAccount, uniqueUsername } from "./helpers/navigation";
import { settled } from "./helpers/settle";
import { it as copy } from "../../locales/it";
import { SLIDE_DURATION } from "../../components/NotificationBanner";
import { Reading } from "../../lib/theme";

const FRIENDS_BUTTON = /^Amici/;
const BANNER = '[data-testid="notification-banner"]';

/**
 * How long the banner has to come to rest before its box is read.
 *
 * This spec builds its own context, so it does not get the reduced motion the
 * `page` fixture emulates and the slide really runs. Room for it plus
 * `settled`'s three samples, and never more than half the banner's own life:
 * it dismisses itself `Reading.notice` after it lands, and a wait that outlived
 * that would measure a banner on its way out — which reads as covering nothing
 * for the same reason reading too early does.
 */
const BANNER_STILL_MS = Math.min(SLIDE_DURATION * 4, Reading.notice / 2);

/** Real handsets and a real tablet, both ways up. A banner costs most where the window is shortest. */
const VIEWPORTS = [
  { name: "phone portrait", width: 390, height: 844 },
  { name: "phone landscape", width: 844, height: 390 },
  { name: "tablet landscape", width: 1112, height: 834 },
] as const;

interface Box { x: number; y: number; width: number; height: number }

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Every control the player can reach, with its box — excluding the banner's
 * own close button, which is allowed to be inside the banner.
 */
async function controls(page: Page): Promise<{ label: string; box: Box }[]> {
  return page.evaluate((bannerSelector) => {
    const banner = document.querySelector(bannerSelector);
    const out: { label: string; box: Box }[] = [];
    const nodes = document.querySelectorAll(
      'button, input, textarea, select, [role="button"], [role="textbox"]'
    );
    for (const el of Array.from(nodes)) {
      if (banner && banner.contains(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.bottom <= 0 || r.top >= window.innerHeight) continue;
      const label =
        el.getAttribute("aria-label") ||
        (el.textContent ?? "").trim().slice(0, 40) ||
        el.tagName.toLowerCase();
      out.push({ label, box: { x: r.x, y: r.y, width: r.width, height: r.height } });
    }
    return out;
  }, BANNER);
}

/** Raises a real banner on the friends screen by sending a friend request. */
async function raiseBanner(page: Page, target: string): Promise<void> {
  await page.getByRole("textbox", { name: copy["friends.searchA11yLabel"] }).fill(target);
  await page.getByRole("button", { name: copy["friends.searchA11yLabel"] }).click();
  const send = page.getByRole("button", {
    name: copy["friends.sendRequestA11yLabel"].replace("{{username}}", target),
  });
  await send.click();
  await expect(page.locator(BANNER)).toContainText(copy["friends.requestSentTitle"], {
    timeout: 15_000,
  });
}

test("a banner displaces the controls under it rather than covering them", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(4 * 60_000);

  const context = await browser.newContext({ locale: "it-IT" });
  const page = await context.newPage();
  const other = await browser.newContext({ locale: "it-IT" });
  const otherPage = await other.newPage();

  try {
    // The recipient only has to exist; the banner is raised on this page.
    const target = uniqueUsername("e2ebandst");
    await openApp(otherPage, baseURL!);
    await registerNewAccount(otherPage, target);

    await page.setViewportSize({ width: VIEWPORTS[0].width, height: VIEWPORTS[0].height });
    await openApp(page, baseURL!);
    await registerNewAccount(page, uniqueUsername("e2ebandsa"));

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.getByRole("button", { name: FRIENDS_BUTTON }).first().click();
      await page.waitForURL(/\/friends/);
      await settled(page, 2_000);

      await raiseBanner(page, target);
      await settled(page, BANNER_STILL_MS, BANNER);
      const bannerBox = (await page.locator(BANNER).boundingBox())!;
      const covered = (await controls(page)).filter((c) => overlaps(c.box, bannerBox));

      expect(
        covered.map((c) => `${c.label} @ y=${Math.round(c.box.y)}`),
        `at ${viewport.name} (${viewport.width}x${viewport.height}) the banner ` +
          `(y=${Math.round(bannerBox.y)}…${Math.round(bannerBox.y + bannerBox.height)}) covers ` +
          `${covered.length} control(s) the player can no longer reach`
      ).toEqual([]);

      // Back to a screen that can reach /friends again for the next viewport.
      await page.goBack();
      await settled(page, 2_000);
    }
  } finally {
    await context.close();
    await other.close();
  }
});
