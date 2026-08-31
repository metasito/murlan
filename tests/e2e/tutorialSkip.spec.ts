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

// `lib/tutorialSeen.ts`'s SEEN_KEY. Every other spec seeds it through
// `openApp`; this one is the exception `tests/onlineTableHarness.test.ts`
// allows for, because the first-run tutorial is what it is about — so it
// asserts on the key rather than setting it.
const SEEN_KEY = "@murlan_tutorial_seen";

test("skipping the first-run tutorial lands on the home screen", async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  await page.setViewportSize(VIEWPORT);

  // Deliberately not `openApp`: its whole job is to seed the flag this test
  // needs unset, so the tutorial is offered the way a first launch offers it.
  await page.goto(baseURL!);

  const skip = page.getByRole("button", { name: "Salta il tutorial" });
  await skip.waitFor({ state: "visible", timeout: 30_000 });

  await skip.click();

  await expect(page.getByRole("button", { name: "Offline" })).toBeVisible({ timeout: 15_000 });
  await expect(skip).toHaveCount(0);

  // And it stays gone. The title screen re-offers the tutorial on every mount
  // while this key is unset, and `router.replace("/")` is a mount — so a Skip
  // that navigated but did not record itself looks, one frame later, exactly
  // like a Skip that did nothing at all.
  const seen = await page.evaluate((key) => window.localStorage.getItem(key), SEEN_KEY);
  expect(seen, "leaving the tutorial did not record that it had been offered").toBe("1");
  await page.waitForTimeout(1_000);
  await expect(skip).toHaveCount(0);
});
