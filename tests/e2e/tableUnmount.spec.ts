// tests/e2e/tableUnmount.spec.ts — leaving the table on the Skia felt throws nothing (#1429): from the
// end-of-partita board through Home, and mid-manche through the table menu.
import { test, expect, type Page } from "@playwright/test";
import { offlineGameSave, resumeSaved } from "./helpers/offlineSeed";
import { skiaOnSoftware, untilSkiaFelt } from "./helpers/tableTrace";
import { GIOCA_VALID_LABEL } from "./helpers/labels";

function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`${err.message}\n${err.stack ?? ""}`));
  return errors;
}

async function playFirstCard(page: Page): Promise<void> {
  await page.locator('[data-hand-state] [data-testid="card-box"]').first().click({ force: true, position: { x: 8, y: 30 } });
  await page.getByRole("button", { name: GIOCA_VALID_LABEL }).click({ force: true, timeout: 10_000 });
}

async function untilHome(page: Page): Promise<void> {
  await page.waitForURL((url) => url.pathname === "/" || url.pathname === "");
  await page.waitForTimeout(1_500);
}

test("Home on the end-of-partita board leaves the Skia felt without an error", async ({ page, baseURL }) => {
  test.setTimeout(3 * 60_000);
  const errors = pageErrors(page);
  const save = offlineGameSave(2, 1, 0);
  save.match.length = "single";
  await skiaOnSoftware(page);
  await resumeSaved(page, baseURL!, save);
  await untilSkiaFelt(page);

  await playFirstCard(page);
  await page.getByTestId("btn-home").click({ timeout: 30_000 });
  await untilHome(page);

  expect(errors).toEqual([]);
});

test("leaving mid-manche through the menu leaves the Skia felt without an error", async ({ page, baseURL }) => {
  test.setTimeout(3 * 60_000);
  const errors = pageErrors(page);
  await skiaOnSoftware(page);
  await resumeSaved(page, baseURL!, offlineGameSave(2, 13, 0));
  await untilSkiaFelt(page);

  await playFirstCard(page);
  await page.getByRole("button", { name: "Impostazioni" }).click();
  await page.getByRole("button", { name: "Esci dalla partita" }).click();
  await page.getByTestId("confirm-accept").click();
  await untilHome(page);

  expect(errors).toEqual([]);
});
