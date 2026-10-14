import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

const REDUCED = "(prefers-reduced-motion: reduce)";

async function plant(page: Page, kind: "error" | "warn"): Promise<void> {
  await Promise.all([page.waitForEvent("console"), page.evaluate((k) => console[k]("planted"), kind)]);
}

test.describe("a browser error fails a test that never names a fixture", () => {
  test.fail();

  test("on the page fixture", async ({ page }) => {
    await plant(page, "error");
  });

  test("on a page of a context the spec opened", async ({ browser }) => {
    const context = await browser.newContext();
    await plant(await context.newPage(), "warn");
    await context.close();
  });

  test("on a page the browser opened directly", async ({ browser }) => {
    const page = await browser.newPage();
    await Promise.all([
      page.waitForEvent("pageerror"),
      page.evaluate(() => {
        void Promise.reject(new Error("planted"));
      }),
    ]);
    await page.close();
  });
});

test("each error is collected once, on every page", async ({ page, browser, browserErrors }) => {
  await plant(page, "error");
  const context = await browser.newContext();
  await plant(await context.newPage(), "warn");
  expect(browserErrors.entries).toEqual(["console.error: planted", "console.warning: planted"]);
  browserErrors.entries.length = 0;
  await context.close();
});

test("a clean page passes", async ({ page }) => {
  await Promise.all([page.waitForEvent("console"), page.evaluate(() => console.log("not an error"))]);
});

test("reduced motion is left alone without consoleErrors", async ({ page }) => {
  expect(await page.evaluate((q) => matchMedia(q).matches, REDUCED)).toBe(false);
});

test("consoleErrors still emulates reduced motion", async ({ page, consoleErrors }) => {
  expect(await page.evaluate((q) => matchMedia(q).matches, REDUCED)).toBe(true);
  expect(consoleErrors.entries).toEqual([]);
});
