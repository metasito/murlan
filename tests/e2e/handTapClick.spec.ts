// tests/e2e/handTapClick.spec.ts — on web a card is selected by the row's tap, not by its own
// pressable: a click selects, a second drops, a press held past the hold is still a press, and
// Enter and Space reach the same tap.
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openSeededGame } from "./helpers/offlineSeed";
import { holdPast, tap } from "./helpers/press";
import { HAND_CARDS, HAND_ZONE, TABLE } from "./helpers/selectors";
import { atRest } from "./helpers/settle";

const VIEWPORT = { width: 844, height: 390 };
const HAND = `${TABLE} ${HAND_ZONE}`;

const top = async (card: Locator) => (await card.boundingBox())!.y;

async function expectPressed(page: Page, card: Locator, on: boolean) {
  await expect(card).toHaveAttribute("aria-pressed", String(on));
  await expect(page.locator(`${HAND_CARDS}[aria-pressed="true"]`)).toHaveCount(on ? 1 : 0);
  await atRest(page, HAND);
}

test("a hand card answers a click, a long press and the keyboard through one tap", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(VIEWPORT);
  await openSeededGame(page, baseURL!, 2, 9, 0, true);
  await page.locator(TABLE).waitFor({ timeout: 30_000 });
  await atRest(page, HAND);

  const card = page.locator(HAND_CARDS).last();
  await expect(card).not.toHaveAttribute("aria-disabled", "true");
  const resting = await top(card);

  await tap(page, card);
  await expectPressed(page, card, true);
  expect(resting - (await top(card)), "the selected card did not rise").toBeGreaterThan(5);

  await tap(page, card);
  await expectPressed(page, card, false);
  expect(Math.abs((await top(card)) - resting), "the dropped card did not come back down").toBeLessThan(1);

  await holdPast(page, card);
  await expectPressed(page, card, true);

  await card.focus();
  await page.keyboard.press("Space");
  await expectPressed(page, card, false);
  await page.keyboard.press("Enter");
  await expectPressed(page, card, true);
});
