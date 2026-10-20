// tests/e2e/tableUnmount.spec.ts — leaving the table on the Skia felt throws nothing (#1429): from the
// end-of-match board through Home, and mid-round through the table menu.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { offlineSave, resumeSaved } from "./helpers/offlineSeed";
import { skiaOnSoftware, untilSkiaFelt } from "./helpers/tableTrace";
import { GIOCA_VALID_LABEL } from "./helpers/labels";
import { tap } from "./helpers/press";

function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`${err.message}\n${err.stack ?? ""}`));
  return errors;
}

async function playTopCard(page: Page): Promise<void> {
  await tap(page, page.locator('[data-hand-state] [data-testid="card-box"]').last());
  await tap(page, page.getByRole("button", { name: GIOCA_VALID_LABEL }));
}

// The felt redraws every sway of the lamp, which on SwiftShader takes the main thread (feltIdle.spec.ts)
// and leaves a press waiting past its reach; at rest it draws only when a card moves.
async function skiaAtRest(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await skiaOnSoftware(page);
}

async function untilHome(page: Page): Promise<void> {
  await page.waitForURL((url) => url.pathname === "/" || url.pathname === "");
  // fixed wait on purpose: the error is thrown frames after the route changes, with no state to wait on.
  await page.waitForTimeout(1_500);
}

test("Home on the end-of-match board leaves the Skia felt without an error", async ({ page, baseURL }) => {
  test.setTimeout(3 * 60_000);
  const errors = pageErrors(page);
  const save = offlineSave({ seats: 2, hand: 1, length: "single" });
  await skiaAtRest(page);
  await resumeSaved(page, baseURL!, save);
  await untilSkiaFelt(page);

  await playTopCard(page);
  await page.getByTestId("btn-home").click({ timeout: 30_000 });
  await untilHome(page);

  expect(errors).toEqual([]);
});

test("leaving mid-round through the menu leaves the Skia felt without an error", async ({ page, baseURL }) => {
  test.setTimeout(3 * 60_000);
  const errors = pageErrors(page);
  await skiaAtRest(page);
  await resumeSaved(page, baseURL!, offlineSave({ seats: 2 }));
  await untilSkiaFelt(page);

  await playTopCard(page);
  await page.getByRole("button", { name: "Impostazioni" }).click();
  await page.getByRole("button", { name: "Esci dalla partita" }).click();
  await page.getByTestId("confirm-accept").click();
  await untilHome(page);

  expect(errors).toEqual([]);
});
