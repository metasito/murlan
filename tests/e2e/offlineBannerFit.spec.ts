// tests/e2e/offlineBannerFit.spec.ts — the offline pill off the table (G2: offline.shape=pill
// offline.tone=solid), in every locale: at the table's font-scale cap, what an OS text size of 3.1
// becomes, its words stay on one line and truncate; the pill stays inside the viewport and covers
// no control. Only a browser runs flexbox; tests/native/offlineBannerLargeText.test.tsx pins the cap
// and the paint.
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openApp } from "./helpers/navigation";
import { setDeviceOffline } from "./helpers/deviceNetwork";

const PILL = '[data-testid="notice-offline"]';
const TEXT = '[data-testid="offline-banner-text"]';
const EXTRAS = pathToFileURL(path.resolve(__dirname, "fixtures", "notice-extras", "index.html")).href;
const TABLE_FONT_SCALE_MAX = 1.2;
const EPS = 1;
const HALF_PT = 0.5;
const LOCALES = ["en-US", "it-IT", "sq-AL"] as const;
const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 874, height: 402 },
] as const;

type Box = { x: number; y: number; w: number; h: number };

const fullyShown = (page: Page, selector: string) =>
  expect
    .poll(
      () =>
        page.evaluate((sel) => {
          const el = document.querySelector(sel);
          let o = el ? 1 : 0;
          for (let n: Element | null = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
          return o;
        }, selector),
      { message: `${selector} fully shown`, timeout: 15_000 }
    )
    .toBe(1);

/** The pill's box after its words take the capped scale, how many lines they wrap to, and every control it covers. */
function measure(page: Page, factor: number) {
  return page.evaluate(
    ([pillSel, textSel, factor]) => {
      const text = document.querySelector<HTMLElement>(textSel)!;
      text.style.fontSize = `${parseFloat(getComputedStyle(text).fontSize) * factor}px`;
      const r = document.querySelector(pillSel)!.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(text);
      const lines = new Set([...range.getClientRects()].map((q) => Math.round(q.top))).size;
      const focusable = [...document.querySelectorAll<HTMLElement>('a[href], button, input, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])')]
        .map((el) => ({ name: el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 24) ?? "", b: el.getBoundingClientRect() }))
        .filter(({ b }) => b.width > 0 && b.height > 0);
      const covered = focusable
        .filter(({ b }) => Math.min(r.right, b.right) - Math.max(r.left, b.left) > 1 && Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top) > 1)
        .map(({ name }) => name);
      return { box: { x: r.left, y: r.top, w: r.width, h: r.height }, lines, controls: focusable.length, covered };
    },
    [PILL, TEXT, factor] as const
  );
}

for (const viewport of VIEWPORTS) {
  for (const locale of LOCALES) {
    test(`the offline pill at the font cap, ${locale}, ${viewport.width}x${viewport.height}`, async ({ browser, baseURL }) => {
      test.setTimeout(120_000);
      const context = await browser.newContext({ locale, viewport });
      const page = await context.newPage();
      try {
        await openApp(page, baseURL!);
        await setDeviceOffline(context, page, true);
        await fullyShown(page, PILL);
        const m = await measure(page, TABLE_FONT_SCALE_MAX);
        await setDeviceOffline(context, page, false);

        const box: Box = m.box;
        expect(m.controls, "the screen has controls to keep clear of").toBeGreaterThan(0);
        expect(m.lines, "its words wrap").toBe(1);
        expect(box.x, `the pill ${JSON.stringify(box)} leaves the viewport on the left`).toBeGreaterThanOrEqual(-EPS);
        expect(box.y).toBeGreaterThanOrEqual(-EPS);
        expect(box.x + box.w, `the pill ${JSON.stringify(box)} leaves the viewport on the right`).toBeLessThanOrEqual(viewport.width + EPS);
        expect(m.covered, "the pill covers these controls").toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
}

test("the offline pill sits where G2's #n-offline does, and is as tall", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const mockupContext = await browser.newContext({ viewport: { width: 874 + 32, height: 900 }, reducedMotion: "reduce" });
  const mockup = await mockupContext.newPage();
  await mockup.goto(EXTRAS);
  await mockup.evaluate(() => document.fonts.ready.then(() => undefined));
  await fullyShown(mockup, "#n-offline");
  const want = await mockup.evaluate(() => {
    const stage = document.querySelector("#sc-offline .stage")!.getBoundingClientRect();
    const k = stage.width / 874;
    const r = document.querySelector("#n-offline")!.getBoundingClientRect();
    return { y: (r.top - stage.top) / k, h: r.height / k };
  });
  await mockupContext.close();

  const context = await browser.newContext({ locale: "it-IT", viewport: { width: 874, height: 402 } });
  const page = await context.newPage();
  try {
    await openApp(page, baseURL!);
    await setDeviceOffline(context, page, true);
    await fullyShown(page, PILL);
    const got = (await measure(page, 1)).box;
    await setDeviceOffline(context, page, false);
    expect(Math.abs(got.y - want.y), `the pill's top: app ${got.y}, mockup ${want.y}`).toBeLessThanOrEqual(HALF_PT);
    expect(Math.abs(got.h - want.h), `the pill's height: app ${got.h}, mockup ${want.h}`).toBeLessThanOrEqual(HALF_PT);
  } finally {
    await context.close();
  }
});
