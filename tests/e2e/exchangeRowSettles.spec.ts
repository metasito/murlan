// tests/e2e/exchangeRowSettles.spec.ts — on a freshly dealt exchange round the hand row ends the
// ceremony as wide as the hand it settles into, so the fan does not jump as the ceremony closes (#1806).
import { test, expect } from "./fixtures";
import { exchangeSave, resumeSaved } from "./helpers/offlineSeed";
import { tap } from "./helpers/press";
import { E2E_REAL_EXCHANGE_KEY } from "../../lib/storageKeys";

const AFTER_MS = 500;

interface Sample { t: number; rowW: number; cardW: number; ceremony: boolean }

const ROLES = [
  {
    role: "winner",
    save: () =>
      exchangeSave({
        seats: 2,
        winner: 0,
        loser: 1,
        cardFromLoser: "2_spades",
        holding: [["5_hearts", "K_spades", "2_spades"], ["J_hearts", "Q_diamonds"]],
      }),
  },
  {
    role: "loser",
    save: () =>
      exchangeSave({
        seats: 2,
        winner: 1,
        loser: 0,
        cardFromLoser: "2_spades",
        holding: [["J_hearts", "Q_diamonds"], ["5_hearts", "K_spades", "2_spades"]],
      }),
  },
] as const;

/**
 * The row in card widths. The hand grows when the turn reaches the viewer (`handCardSize`), and the
 * ceremony closing is what hands it over, so the row's raw width legitimately steps there; in card
 * widths it moves only with the slot count.
 */
const slots = (s: Sample) => s.rowW / s.cardW;

for (const { role, save } of ROLES) {
  test(`the ${role}'s hand row ends the ceremony as wide as the hand it settles into`, async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    await page.addInitScript((key) => window.localStorage.setItem(key, "1"), E2E_REAL_EXCHANGE_KEY);
    await page.addInitScript((afterMs) => {
      const out: Sample[] = [];
      const w = window as unknown as { __rows: Sample[]; __settled?: boolean };
      w.__rows = out;
      let began = false;
      let ended: number | null = null;
      const frame = () => {
        const t = performance.now();
        const ceremony = document.querySelector('[data-testid="exchange-announce"]') !== null;
        const row = document.querySelector<HTMLElement>('[data-testid="hand-row"]');
        const card = row?.querySelector<HTMLElement>('[data-testid^="hand-card-"]');
        if (ceremony) began = true;
        if (began && row && card) out.push({ t, rowW: row.getBoundingClientRect().width, cardW: card.offsetWidth, ceremony });
        if (began && !ceremony && ended === null) ended = t;
        if (ended !== null && t - ended >= afterMs) w.__settled = true;
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }, AFTER_MS);
    await resumeSaved(page, baseURL!, save());

    if (role === "winner") {
      await expect(page.getByTestId("exchange-prompt")).toBeVisible({ timeout: 15_000 });
      await tap(page, page.getByRole("button", { name: "5 di Cuori", exact: true }));
      await tap(page, page.getByTestId("btn-gioca"));
    }
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __settled?: boolean }).__settled === true), { timeout: 60_000 })
      .toBe(true);
    const rows = await page.evaluate(() => (window as unknown as { __rows: Sample[] }).__rows);

    const during = rows.filter((s) => s.ceremony);
    expect(during.length, "the ceremony was sampled").toBeGreaterThan(10);
    const last = during[during.length - 1];
    const settled = rows[rows.length - 1];
    expect(settled.ceremony, "the row was sampled after the ceremony").toBe(false);
    const trace = rows
      .filter((s, i) => i === 0 || Math.abs(s.rowW - rows[i - 1].rowW) > 0.5)
      .map((s) => `${s.rowW.toFixed(1)}/${s.cardW}@${(s.t - rows[0].t).toFixed(0)}${s.ceremony ? "" : " after"}`)
      .join(", ");
    // The floor: the ceremony steps the row for the card in the air, so this measure does move with the
    // slot count, and the equality below is not a number that never changes.
    expect(new Set(during.map((s) => slots(s).toFixed(2))).size, `the row stepped during the ceremony: ${trace}`).toBeGreaterThan(1);
    expect(slots(last), `the last ceremony frame against the settled row: ${trace}`).toBeCloseTo(slots(settled), 2);
  });
}
