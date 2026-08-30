// tests/e2e/profileSignedOut.spec.ts — Profile is reachable with no account,
// and a look chosen there survives getting one.
//
// This is the claim the whole of #343 rests on. Cosmetics are deliberately
// local (`lib/cosmetics.ts`, #98) and a signed-out player can already pick a
// card back, so moving the picker behind the login-gated `(online)` group
// would take that away — a regression dressed as a feature. Reading the two
// storage keys says they are independent; only a browser says the screen is
// actually reachable and the choice actually survives, which is a different
// claim and the one that matters.
import { test, expect, type Page } from "@playwright/test";
import { openApp, registerNewAccount, uniqueUsername } from "./helpers/navigation";

const FELT_SECTION = '[data-testid="profile-look"]';

// Read from the token sets rather than imported: this file runs in Playwright's
// own process, which has no React Native module resolution.
const CARD_BACKS = 5;
const FELTS = 4;

/** The felt the app is currently painting with, from its own settings store. */
async function storedFelt(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("@murlan_settings");
    if (!raw) return null;
    try {
      return (JSON.parse(raw) as { tableFelt?: string }).tableFelt ?? null;
    } catch {
      return null;
    }
  });
}

test.describe("Profile without an account", () => {
  test("is reachable signed out, and the look chosen there survives registering", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    await openApp(page, baseURL!);
    await page.evaluate(() => window.localStorage.setItem("@murlan_tutorial_seen", "1"));
    await page.reload();
    await page.waitForLoadState("networkidle");

    await page.goto(`${baseURL}/profile`);
    await page.waitForLoadState("networkidle");

    // Not a redirect and not a disabled section: the look picker is the point
    // of the screen existing outside the group.
    await expect(
      page.locator(FELT_SECTION),
      "a player with no account can still choose how the game looks"
    ).toBeVisible({ timeout: 20_000 });

    const before = await storedFelt(page);
    const pick = page.locator(`${FELT_SECTION} [role="button"][aria-label*="Bordeaux"]`).first();
    await expect(pick, "every felt is offered, not just the default").toBeVisible();
    await pick.click();
    await page.waitForTimeout(600);

    const chosen = await storedFelt(page);
    expect(chosen, "choosing a felt with no account writes it").toBe("bordeaux");
    expect(chosen, "the test picked a felt that was not already set").not.toBe(before);

    // The endowment argument on #343 is only worth anything if the thing the
    // player built is still there afterwards. A choice discarded at signup is
    // worse than never having offered it.
    await page.goto(`${baseURL}/`);
    await page.waitForLoadState("networkidle");
    await registerNewAccount(page, uniqueUsername("cosm"));

    expect(
      await storedFelt(page),
      "registering must not discard the look the player already chose"
    ).toBe("bordeaux");

    await page.goto(`${baseURL}/profile`);
    await page.waitForLoadState("networkidle");
    await expect(
      page.locator(FELT_SECTION),
      "the same picker is on the signed-in screen, not a second one elsewhere"
    ).toBeVisible({ timeout: 20_000 });
  });

  // Menus do both orientations, and the pickers are the widest thing on the
  // screen: five card backs and four felts in a row. Each row is its own
  // horizontal scroller, so nothing is ever cut off — which makes geometry a
  // vacuous thing to assert. What can actually go wrong is an option that
  // cannot be worked at that window size, so this operates the last one in
  // each row, the one furthest along the scroll.
  for (const [name, width, height] of [
    ["portrait", 390, 844],
    ["landscape", 844, 390],
  ] as const) {
    test(`the far end of each picker still works in ${name}`, async ({ page, baseURL }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height });
      await openApp(page, baseURL!);
      await page.evaluate(() => window.localStorage.setItem("@murlan_tutorial_seen", "1"));
      await page.goto(`${baseURL}/profile`);
      await page.waitForLoadState("networkidle");
      await expect(page.locator(FELT_SECTION)).toBeVisible({ timeout: 20_000 });

      const options = page.locator(`${FELT_SECTION} [role="button"]`);
      await expect(options, "both pickers render their whole set").toHaveCount(CARD_BACKS + FELTS);

      for (const i of [CARD_BACKS - 1, CARD_BACKS + FELTS - 1]) {
        const option = options.nth(i);
        await option.scrollIntoViewIfNeeded();
        await option.click();
        await expect(
          option,
          `the last option of a row must be operable in ${name}`
          // `selected` on a control reaches the DOM as `aria-pressed`;
          // `aria-selected` belongs to options in a listbox, and never appears.
        ).toHaveAttribute("aria-pressed", "true");
      }
    });
  }
});
