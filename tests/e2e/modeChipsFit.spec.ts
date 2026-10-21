// A mode chip whose word is cut to an ellipsis names nothing: every lobby's mode
// chips show their whole word, in each locale whose words are long, at both
// orientations of the smallest handset.

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { openApp, registerNewAccount, uniqueUsername } from "./helpers/navigation";
import { PHONES } from "./helpers/phones";
import { it } from "../../locales/it.ts";
import { sq } from "../../locales/sq.ts";
import { LOCALE_KEY } from "../../lib/storageKeys.ts";

const SMALLEST = PHONES.reduce((a, b) => (a.width * a.height <= b.width * b.height ? a : b));
const ORIENTATIONS = {
  landscape: { width: SMALLEST.width, height: SMALLEST.height },
  portrait: { width: SMALLEST.height, height: SMALLEST.width },
};
const LOCALES = { it, sq };

type Catalogue = typeof it;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Each chip's label, and whether any text inside the chip is cut short of its own width. */
async function chipFit(page: Page, words: string[]) {
  const found: { word: string; textWidth: number; cut: boolean }[] = [];
  for (const word of words) {
    const chip = page.getByRole("radio", { name: new RegExp(`^${escape(word)}`) });
    await chip.waitFor();
    found.push({
      word,
      ...(await chip.evaluate((el) => {
        const texts = [...el.querySelectorAll("div")].filter((d) => d.childElementCount === 0 && d.textContent);
        return {
          textWidth: Math.max(0, ...texts.map((d) => d.scrollWidth)),
          cut: texts.some((d) => d.scrollWidth > d.clientWidth + 1 || d.scrollHeight > d.clientHeight + 1),
        };
      })),
    });
  }
  return found;
}

async function expectWholeWords(
  page: Page,
  words: Record<keyof typeof ORIENTATIONS, string[]>,
  where: string
) {
  for (const orientation of Object.keys(ORIENTATIONS) as (keyof typeof ORIENTATIONS)[]) {
    await page.setViewportSize(ORIENTATIONS[orientation]);
    // Turning the window rebuilds the lobby, so a chip read mid-turn is a detached one with no size.
    await expect
      .poll(async () => (await chipFit(page, words[orientation])).every((c) => c.textWidth > 0))
      .toBe(true);
    const chips = await chipFit(page, words[orientation]);
    expect(chips, `${where} ${orientation}: both mode chips measured`).toHaveLength(2);
    for (const chip of chips) {
      expect(chip.textWidth, `${where} ${orientation}: "${chip.word}" has a label`).toBeGreaterThan(0);
      expect(chip.cut, `${where} ${orientation}: "${chip.word}" is cut short`).toBe(false);
    }
  }
}

test("every lobby's mode chips show their whole word, in it and sq, portrait and landscape", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(3 * 60_000);
  await openApp(page, baseURL!);
  await registerNewAccount(page, uniqueUsername("chips"));

  for (const [name, L] of Object.entries(LOCALES) as [string, Catalogue][]) {
    await page.setViewportSize(ORIENTATIONS.portrait);
    await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [LOCALE_KEY, name]);
    await page.goto(baseURL!);
    await page.getByRole("button", { name: L["home.modeOffline"], exact: true }).click();
    await expectWholeWords(
      page,
      {
        portrait: [L["term.mode.freeForAll"], L["term.mode.teams"]],
        landscape: [L["term.mode.freeForAllShort"], L["term.mode.teamsShort"]],
      },
      `${name} /lobby`
    );

    await page.setViewportSize(ORIENTATIONS.portrait);
    await page.goto(baseURL!);
    await page.getByRole("button", { name: L["home.modePlayWithFriends"] }).click();
    const short = [L["term.mode.freeForAllShort"], L["term.mode.teamsShort"]];
    await expectWholeWords(page, { portrait: short, landscape: short }, `${name} /(online)`);
  }
});
