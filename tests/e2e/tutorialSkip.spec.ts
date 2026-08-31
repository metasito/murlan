// tests/e2e/tutorialSkip.spec.ts — Skip leaves the tutorial, in a browser.
//
// #619 reports the control doing nothing on Android. Every other test in this
// suite seeds `@murlan_tutorial_seen` before loading the app (helpers/
// navigation.ts) precisely so the tutorial never appears, which is why nothing
// has ever driven this control end to end. Whatever the device turns out to be
// doing, the browser's answer has to be on record first: it is the difference
// between a defect and a platform difference.

import { test, expect } from "./fixtures";

// iPhone 12, the handset the layout suite runs on.
const VIEWPORT = { width: 390, height: 844 };

test("skipping the first-run tutorial lands on the home screen", async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  await page.setViewportSize(VIEWPORT);

  // Deliberately not `openApp`: its whole job is to seed the flag this test
  // needs unset, so the tutorial is offered the way a first launch offers it.
  await page.goto(baseURL!);

  const skip = page.getByRole("button", { name: "Salta il tutorial" });
  await skip.waitFor({ state: "visible", timeout: 30_000 });

  await skip.click();

  // The tutorial is gone and the home screen is under it — and it stays gone,
  // which is the other way this can fail: the title screen re-offers the
  // tutorial on every mount unless the seen flag was written on the way out.
  await expect(page.getByRole("button", { name: "Offline" })).toBeVisible({ timeout: 15_000 });
  await expect(skip).toHaveCount(0);
});
