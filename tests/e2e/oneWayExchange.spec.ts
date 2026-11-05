// tests/e2e/oneWayExchange.spec.ts — a one-way exchange is told by the table's two pills and nothing on the felt (#1833).
// The deal is rigged (helpers/oneWayDeal.ts): Ana wins holding nothing from 3 to 10, Luan loses and leads.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { installVirtualClock, step, stepUntil } from "./helpers/virtualClock";
import { resumeOnVirtualClock } from "./helpers/offlineSeed";
import { expectNoteFits, NEIGHBOUR_IDS, readPillFacts } from "./helpers/pillNote";
import { LOCALE_KEY } from "../../lib/storageKeys";
import { en } from "../../locales/en";
import { it } from "../../locales/it";
import { sq } from "../../locales/sq";
import { oneWaySave, rigTheDeal, ONE_WAY_NAMES } from "./helpers/oneWayDeal";

const NOTE = '[data-testid="exchange-pill-note"]';
const COMBO_PILL = '[data-testid="notice-hudCombo"]';
const TURN_PILL = '[data-testid="notice-turn"]';

const text = (page: Page, selector: string) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, selector);
const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;

const LANGUAGES = [
  { locale: "it", strings: it },
  { locale: "en", strings: en },
  { locale: "sq", strings: sq },
] as const;
type Strings = Record<string, string>;
const say = (strings: Strings, key: string, vars: Record<string, string> = {}) =>
  Object.entries(vars).reduce((out, [k, v]) => out.replaceAll(`{{${k}}}`, v), strings[key]);

async function play(page: Page, baseURL: string, locale: string, strings: Strings) {
  await installVirtualClock(page, 1833);
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [LOCALE_KEY, locale]);
  await resumeOnVirtualClock(page, baseURL, oneWaySave(), () => rigTheDeal(page), undefined, strings["home.resumeGame"]);
  await stepUntil(page, () => page.locator(NOTE).isVisible(), "the receive resting on the last-played pill", { chunkMs: 100 });
}

for (const { locale, strings } of LANGUAGES)
for (const viewport of [{ width: 844, height: 390 }, { width: 667, height: 375 }, { width: 1024, height: 768 }]) {
  test(`${viewport.width}px in ${locale}: the receive, then the winner's nothing to give back, are said by the pills`, async ({ page, baseURL }) => {
    test.setTimeout(240_000);
    await page.setViewportSize(viewport);
    await play(page, baseURL!, locale, strings);

    const receive = await text(page, NOTE);
    expect(receive).toBe(say(strings, "exchange.pileGivesYou", { from: ONE_WAY_NAMES[1], card: "2♣" }));
    expect(await text(page, COMBO_PILL)).toContain("2♣");
    await expect(page.getByTestId("exchange-pile-label")).toHaveCount(0);
    expectNoteFits(await page.evaluate(readPillFacts, NEIGHBOUR_IDS), viewport, "the receive");
    const pile = await box(page, '[data-testid="pile-area"]');
    const note = await box(page, NOTE);
    expect(note.y + note.height, "the note is up in the pill, not on the felt").toBeLessThan(pile.y);

    await stepUntil(page, async () => {
      const now = await text(page, NOTE);
      return now !== null && now !== receive;
    }, "the beat", { chunkMs: 100 });
    expect(await text(page, TURN_PILL)).toContain(strings["exchange.chipOneWayYou"]);
    expectNoteFits(await page.evaluate(readPillFacts, NEIGHBOUR_IDS), viewport, "the beat");
    const turn = await box(page, TURN_PILL);
    expect(turn.x + turn.width).toBeLessThanOrEqual(viewport.width);
    await expect(page.getByTestId("exchange-pile-label")).toHaveCount(0);

    await stepUntil(page, () => page.getByTestId("notice-whoStarts").isVisible(), "the who-starts panel", { chunkMs: 100 });
    await expect(page.getByTestId("notice-whoStarts")).toContainText(strings["gameShared.startReasonOneWaySubYou"]);
    await step(page);
  });
}
