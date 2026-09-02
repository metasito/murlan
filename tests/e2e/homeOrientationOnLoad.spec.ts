// tests/e2e/homeOrientationOnLoad.spec.ts — the half of #819 a browser can
// settle: whichever composition a real viewport earns, it is the *only* one
// on screen, and its narrowest column still fits the longest of the three
// locales' words. The race itself — iOS misreading its own window on a cold
// launch — is not reproducible here: Chromium's window is correct from its
// very first script tick, which is exactly why `lib/orientation.tsx` has a
// native test for that half and this file has the layout instead.
import { test, expect, type Page } from "@playwright/test";
import { openApp, registerNewAccount, uniqueUsername } from "./helpers/navigation";
import { en } from "../../locales/en";
import { it as itCopy } from "../../locales/it";
import { sq } from "../../locales/sq";

const PORTRAIT = { width: 390, height: 844 };
// Narrower than the phones the other home specs use: the brand column most
// at risk of crowding "Friends"/"Ranking" is the one with the least room.
const LANDSCAPE_TIGHT = { width: 667, height: 375 };

const LOCALES = [
  { key: "it", copy: itCopy },
  { key: "en", copy: en },
  { key: "sq", copy: sq },
] as const;

async function setLocale(page: Page, key: string): Promise<void> {
  await page.evaluate((l) => window.localStorage.setItem("murlan.locale", l), key);
  await page.reload();
  await page
    .locator('[data-testid="home-account-pair"]:visible')
    .waitFor({ state: "visible" });
}

/**
 * How many visual lines the element's own text occupies. `getClientRects()`
 * on the element itself answers for its block-level box, always one rect
 * regardless of how the text inside it wraps — a `Range` over its contents
 * is what returns one rect per line.
 */
async function lineCount(page: Page, text: string): Promise<number> {
  return page.getByText(text, { exact: true }).evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getClientRects().length;
  });
}

test("the portrait composition never carries a landscape-only pair", async ({ page, baseURL }) => {
  await page.setViewportSize(PORTRAIT);
  await openApp(page, baseURL!);
  await registerNewAccount(page, uniqueUsername("orient"));

  await expect(page.locator('[data-testid="home-account-pair"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="home-account-avatar"]')).toHaveCount(0);
});

test("Friends and Ranking read as one word each, in every locale, at a tight landscape width", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize(PORTRAIT);
  await openApp(page, baseURL!);
  await registerNewAccount(page, uniqueUsername("orient"));
  await page.setViewportSize(LANDSCAPE_TIGHT);

  for (const { key, copy } of LOCALES) {
    await setLocale(page, key);

    const friends = copy["home.friendsLabel"];
    const ranking = copy["home.leaderboard"];

    expect(await lineCount(page, friends), `"${friends}" (${key}) wraps`).toBe(1);
    expect(await lineCount(page, ranking), `"${ranking}" (${key}) wraps`).toBe(1);
  }
});
