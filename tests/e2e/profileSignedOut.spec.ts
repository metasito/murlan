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
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openApp, registerNewAccount, uniqueUsername } from "./helpers/navigation";

const FELT_SECTION = '[data-testid="profile-look"]';
// Signed in and landscape, the entry is the avatar; everywhere else it is the
// Profile control. Either is the same door.
const HOME_PROFILE =
  '[data-testid="home-account-profile"], [data-testid="home-account-avatar"]';

/**
 * Reach Profile the way a player does. Typing the URL only asks whether the
 * route resolves; whether anyone can get there is a different question, and
 * signed out it is the whole question — the two cosmetics rows have left
 * Settings, so home is the only door left.
 */
async function openProfileFromHome(page: Page): Promise<void> {
  // Both orientation branches mount; layout hides one of them.
  await page.locator(`${HOME_PROFILE} >> visible=true`).first().click();
  await expect(page.locator(FELT_SECTION)).toBeVisible({ timeout: 20_000 });
}

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
    consoleErrors,
  }) => {
    test.setTimeout(180_000);
    await openApp(page, baseURL!);
    await page.evaluate(() => window.localStorage.setItem("@murlan_tutorial_seen", "1"));
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Not a redirect and not a disabled section: the look picker is the point
    // of the screen existing outside the group.
    await expect(
      page.locator(`${HOME_PROFILE} >> visible=true`).first(),
      "a player with no account is offered a way to Profile at all"
    ).toBeVisible({ timeout: 20_000 });
    await openProfileFromHome(page);

    const before = await storedFelt(page);
    const pick = page.locator(`${FELT_SECTION} [role="radio"][aria-label*="Bordeaux"]`).first();
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

    await openProfileFromHome(page);

    // A route that moves out of its group leaves the old group's layout
    // declaring a screen that is not there any more, and expo-router says so
    // in a console warning rather than a failure — the screen still renders.
    // The spec that owns the route is where that has to be caught.
    expect(consoleErrors.entries, "no console errors on the profile route").toEqual([]);
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
    test(`the far end of each picker still works in ${name}`, async ({
      page,
      baseURL,
      consoleErrors,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height });
      await openApp(page, baseURL!);
      await page.evaluate(() => window.localStorage.setItem("@murlan_tutorial_seen", "1"));
      await openProfileFromHome(page);

      const options = page.locator(`${FELT_SECTION} [role="radio"]`);
      await expect(options, "both pickers render their whole set").toHaveCount(CARD_BACKS + FELTS);

      for (const i of [CARD_BACKS - 1, CARD_BACKS + FELTS - 1]) {
        const option = options.nth(i);
        await option.scrollIntoViewIfNeeded();
        await option.click();
        await expect(
          option,
          `the last option of a row must be operable in ${name}`
          // One exclusive set, so each option is a radio and carries
          // `aria-checked`. `aria-selected` belongs to a listbox and
          // `aria-pressed` to an independent toggle; neither appears here.
        ).toHaveAttribute("aria-checked", "true");
      }

      expect(consoleErrors.entries, `no console errors on the profile route in ${name}`).toEqual(
        []
      );
    });
  }
});
