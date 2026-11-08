import type { Page } from "@playwright/test";
import { test, expect, failOnBrowserErrors } from "./fixtures";

const REDUCED = "(prefers-reduced-motion: reduce)";

async function plant(page: Page, kind: "error" | "warn"): Promise<void> {
  await Promise.all([page.waitForEvent("console"), page.evaluate((k) => console[k]("planted"), kind)]);
}

/** What the auto fixture's teardown would throw, emptied after so the test itself passes. */
function teardownFails(browserErrors: { entries: string[] }): void {
  expect(() => failOnBrowserErrors(browserErrors.entries)).toThrow(/Browser reported 1 error/);
  browserErrors.entries.length = 0;
}

test.describe("a browser error fails the test, on every page", () => {
  test("on the page fixture", async ({ page, browserErrors }) => {
    await plant(page, "error");
    teardownFails(browserErrors);
  });

  test("on a page of a context the spec opened", async ({ browser, browserErrors }) => {
    const context = await browser.newContext();
    await plant(await context.newPage(), "warn");
    await context.close();
    teardownFails(browserErrors);
  });

  test("on a page the browser opened directly", async ({ browser, browserErrors }) => {
    const page = await browser.newPage();
    await Promise.all([
      page.waitForEvent("pageerror"),
      page.evaluate(() => {
        void Promise.reject(new Error("planted"));
      }),
    ]);
    await page.close();
    teardownFails(browserErrors);
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
