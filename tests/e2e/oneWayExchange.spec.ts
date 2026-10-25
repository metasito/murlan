// tests/e2e/oneWayExchange.spec.ts — a one-way exchange is told by the table's two pills and nothing on the felt (#1833).
// The deal is rigged (helpers/oneWayDeal.ts): Ana wins holding nothing from 3 to 10, Luan loses and leads.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { installVirtualClock, step, stepUntil } from "./helpers/virtualClock";
import { resumeOnVirtualClock } from "./helpers/offlineSeed";
import { oneWaySave, rigTheDeal, ONE_WAY_NAMES } from "./helpers/oneWayDeal";

const NOTE = '[data-testid="exchange-pill-note"]';
const COMBO_PILL = '[data-testid="notice-hudCombo"]';
const TURN_PILL = '[data-testid="notice-turn"]';

const text = (page: Page, selector: string) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, selector);
const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;

async function play(page: Page, baseURL: string) {
  await installVirtualClock(page, 1833);
  await resumeOnVirtualClock(page, baseURL, oneWaySave(), () => rigTheDeal(page));
  await stepUntil(page, () => page.locator(NOTE).isVisible(), "the receive resting on the last-played pill", { chunkMs: 100 });
}

for (const viewport of [{ width: 844, height: 390 }, { width: 667, height: 375 }, { width: 1024, height: 768 }]) {
  test(`${viewport.width}px: the receive, then the winner's nothing to give back, are said by the pills`, async ({ page, baseURL }) => {
    test.setTimeout(240_000);
    await page.setViewportSize(viewport);
    await play(page, baseURL!);

    const receive = await text(page, NOTE);
    expect(receive).toBe(`${ONE_WAY_NAMES[1]} ti dà 2♣`);
    expect(await text(page, COMBO_PILL)).toContain("2♣");
    await expect(page.getByTestId("exchange-pile-label")).toHaveCount(0);
    const pile = await box(page, '[data-testid="pile-area"]');
    const note = await box(page, NOTE);
    expect(note.y + note.height, "the note is up in the pill, not on the felt").toBeLessThan(pile.y);

    await stepUntil(page, async () => {
      const now = await text(page, NOTE);
      return now !== null && now !== receive;
    }, "the beat", { chunkMs: 100 });
    expect(await text(page, TURN_PILL)).toContain("Senso unico: Tu");
    const combo = await box(page, COMBO_PILL);
    const turn = await box(page, TURN_PILL);
    expect(combo.x + combo.width, "the two pills do not touch").toBeLessThan(turn.x);
    expect(combo.x).toBeGreaterThanOrEqual(0);
    expect(turn.x + turn.width).toBeLessThanOrEqual(viewport.width);
    await expect(page.getByTestId("exchange-pile-label")).toHaveCount(0);

    await stepUntil(page, () => page.getByTestId("notice-whoStarts").isVisible(), "the who-starts panel", { chunkMs: 100 });
    await expect(page.getByTestId("notice-whoStarts")).toContainText("Non avevi carte da 3 a 10 da restituire");
    await step(page);
  });
}
