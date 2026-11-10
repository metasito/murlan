// tests/e2e/exchangeNoOverlap.spec.ts — the two exchanged cards never share the table, and the note
// that names each exchange sits whole in its label under the pile. Only a browser can say where
// transformed views and a pill actually land (docs/agents/checks.md).
import { expectNoteFits, NEIGHBOUR_IDS, readPillFacts } from "./helpers/pillNote";
import { test, expect } from "./fixtures";
import { exchangeSave, resumeSaved, seedSave } from "./helpers/offlineSeed";
import { openApp } from "./helpers/navigation";
import { LOCALE_KEY } from "../../lib/storageKeys";
import { en } from "../../locales/en";
import { sq } from "../../locales/sq";
import { tap } from "./helpers/press";
import { paintedFrames, type EachPaint } from "./helpers/virtualClock";

const GIVEBACK_SPOKEN = "5 di Cuori";
const LEGS = ["exchange-flier-to-winner", "exchange-flier-to-loser"] as const;

/** The viewer has just won a round and is about to choose what to hand back. */
const midExchangeSave = () =>
  exchangeSave({
    seats: 2,
    winner: 0,
    loser: 1,
    cardFromLoser: "2_spades",
    holding: [["5_hearts", "K_spades", "2_spades"], ["J_hearts", "Q_diamonds"]],
  });

test.beforeEach(({ page }) => paintedFrames(page));

test("the give shows only once the receive has landed: never two cards in the air", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await resumeSaved(page, baseURL!, midExchangeSave());
  await page.evaluate((legs) => {
    const out: { t: number; shown: string[]; x: number; y: number }[] = [];
    (window as unknown as { __legs: typeof out }).__legs = out;
    const t0 = performance.now();
    const frame = () => {
      const shown = legs.filter((leg) => {
        const el = document.querySelector(`[data-testid="${leg}"]`);
        return el && Number(getComputedStyle(el).opacity) > 0;
      });
      const el = shown[0] ? document.querySelector(`[data-testid="${shown[0]}"]`) : null;
      const r = el?.getBoundingClientRect();
      out.push({ t: performance.now() - t0, shown, x: r?.x ?? 0, y: r?.y ?? 0 });
    };
    (window as unknown as { murlanEachPaint: EachPaint }).murlanEachPaint(frame);
  }, LEGS);

  await expect(page.getByTestId("exchange-prompt")).toBeVisible({ timeout: 15_000 });
  await tap(page, page.getByRole("button", { name: GIVEBACK_SPOKEN, exact: true }));
  await tap(page, page.getByTestId("btn-gioca"));
  await expect(page.getByTestId("exchange-flier-to-loser")).toHaveCount(0, { timeout: 20_000 });

  const track = await page.evaluate(() => (window as unknown as { __legs: { t: number; shown: string[]; x: number; y: number }[] }).__legs);
  for (const leg of LEGS) {
    const own = track.filter((f) => f.shown.includes(leg) && f.shown.length === 1);
    expect(own.length, `${leg} was drawn`).toBeGreaterThan(10);
    const travel = Math.max(...own.map((f) => Math.hypot(f.x - own[0].x, f.y - own[0].y)));
    expect(travel, `${leg} has to cross the table`).toBeGreaterThan(20);
  }
  expect(track.filter((f) => f.shown.length > 1).map((f) => f.t.toFixed(0)), "both cards were in the air at once").toEqual([]);
});

for (const size of [{ width: 667, height: 375 }, { width: 844, height: 390 }, { width: 1024, height: 768 }]) {
  test(`the exchange note sits whole in its label under the pile, clear of the turn pill and the HUD — ${size.width}px`, async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    await resumeSaved(page, baseURL!, midExchangeSave());

    await expect(page.getByTestId("exchange-pill-note")).toBeVisible({ timeout: 15_000 });
    expectNoteFits(await page.evaluate(readPillFacts, NEIGHBOUR_IDS), size, `${size.width}px`);
  });
}

// The widest the note ever sits against the turn pill is the tablet, whichever language the player reads it in.
const LANGUAGES = [{ locale: "en", resume: en["home.resumeGame"] }, { locale: "sq", resume: sq["home.resumeGame"] }];
for (const { locale, resume } of LANGUAGES) {
  test(`the exchange note clears the turn pill at 1024px in ${locale}`, async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    const size = { width: 1024, height: 768 };
    await page.setViewportSize(size);
    await seedSave(page, midExchangeSave());
    await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [LOCALE_KEY, locale]);
    await openApp(page, baseURL!);
    await page.getByRole("button", { name: resume }).click({ timeout: 60_000 });

    await expect(page.getByTestId("exchange-pill-note")).toBeVisible({ timeout: 15_000 });
    expectNoteFits(await page.evaluate(readPillFacts, NEIGHBOUR_IDS), size, `${locale} ${size.width}px`);
  });
}
