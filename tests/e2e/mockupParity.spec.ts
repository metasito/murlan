import { test, expect, type Page } from "@playwright/test";
import { CANVASKIT_ROUTE, heldTurnTable, newSidePage, parityTests, recorded, traced } from "./helpers/mockupParity";
import { step, stepUntil } from "./helpers/virtualClock";

test.describe("mockup parity", () => {
  parityTests("rest");

  const lastFelt = async (page: Page) => (await recorded(page)).at(-1)?.felt;

  test("the table plays before Skia is ready, then shows the Skia felt", async ({ browser, baseURL }) => {
    test.setTimeout(5 * 60_000);
    const page = await newSidePage(browser, baseURL);
    let release = () => {};
    const held = new Promise<void>((r) => (release = r));
    await page.route(CANVASKIT_ROUTE, async (route) => {
      await held;
      await route.continue();
    });
    await heldTurnTable(page, baseURL!);
    await traced(page, (f) => f.felt === "fallback", "the fallback felt");
    await page.locator('[data-hand-state] [data-testid="card-box"]').first().click({ force: true });
    await stepUntil(page, async () => (await page.locator('[data-hand-state] [aria-pressed="true"]').count()) === 1, "a card selected");
    expect(await lastFelt(page), "the felt when the card was taken").toBe("fallback");
    release();
    await stepUntil(page, async () => (await lastFelt(page)) === "skia", "the Skia felt");
    await page.context().close();
  });

  test("a CanvasKit that cannot load leaves the fallback felt under a live table", async ({ browser, baseURL }) => {
    test.setTimeout(5 * 60_000);
    const page = await newSidePage(browser, baseURL);
    await page.route(CANVASKIT_ROUTE, (route) => route.abort());
    const failed = page.waitForEvent("requestfailed", (r) => r.url().includes("canvaskit-wasm@"));
    await heldTurnTable(page, baseURL!);
    await traced(page, (f) => f.felt === "fallback", "the fallback felt");
    await failed;
    for (let i = 0; i < 30; i++) await step(page);
    expect(await lastFelt(page)).toBe("fallback");
    await expect(page.locator('[data-hand-state] [data-testid="card-box"]').first()).toBeVisible();
    await page.context().close();
  });
});
