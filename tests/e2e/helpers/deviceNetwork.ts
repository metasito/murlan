import type { BrowserContext, Page } from "@playwright/test";

/** NetInfo's web module hears only `navigator.connection`'s `change` where it exists, which Playwright's offline emulation never fires. */
export async function setDeviceOffline(context: BrowserContext, page: Page, offline: boolean): Promise<void> {
  await context.setOffline(offline);
  await page.evaluate(() => {
    const connection = (navigator as Navigator & { connection?: EventTarget }).connection;
    (connection ?? window).dispatchEvent(new Event(connection ? "change" : navigator.onLine ? "online" : "offline"));
  });
}
