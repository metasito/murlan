// tests/e2e/exchangeNoOverlap.spec.ts — the two exchanged cards never share the table, and the note
// that names each exchange sits whole in the last-played pill. Only a browser can say where
// transformed views and a pill actually land (docs/agents/checks.md).
import { expectNoteFits, NEIGHBOUR_IDS, readPillFacts } from "./helpers/pillNote";
import { test, expect } from "./fixtures";
import { exchangeSave, resumeSaved } from "./helpers/offlineSeed";
import { tap } from "./helpers/press";

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
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
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
  test(`the exchange note sits whole in the last-played pill, clear of the turn pill and the HUD — ${size.width}px`, async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    await resumeSaved(page, baseURL!, midExchangeSave());

    await expect(page.getByTestId("exchange-pill-note")).toBeVisible({ timeout: 15_000 });
    expectNoteFits(await page.evaluate(readPillFacts, NEIGHBOUR_IDS), size, `${size.width}px`);
  });
}
