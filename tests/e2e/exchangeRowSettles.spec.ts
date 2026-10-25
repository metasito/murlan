// tests/e2e/exchangeRowSettles.spec.ts — on a freshly dealt exchange round the hand row ends the
// ceremony as wide as the hand it settles into, so the fan does not jump as the ceremony closes (#1806).
import { test, expect } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { exchangeSave, resumeOnVirtualClock } from "./helpers/offlineSeed";
import { installVirtualClock, paintedFrames, step, stepThen, stepUntil, type EachPaint } from "./helpers/virtualClock";
import { E2E_REAL_EXCHANGE_KEY } from "../../lib/storageKeys";
import { HAND_SCALE, HAND_SCALE_ON_TURN } from "../../components/cardFaceModel";

const AFTER_MS = 500;
const TURN_RATIO = HAND_SCALE_ON_TURN / HAND_SCALE;
/** Both widths are fractional layout widths, so equal ones agree far inside this; one slot is over 0.6 card. */
const SLOT_TOLERANCE = 0.01;
const SIZE_TOLERANCE = 0.001;

/**
 * `cardW` is the card's laid-out width, not its bounding box: the box also carries the card's
 * rotation, lift and the scale a resize animates through, which move it at a constant size.
 * `cardDrawn` is that width under the card's own transform scale.
 */
interface Sample { t: number; ceremony: boolean; rowW: number; cardW: number; cardDrawn: number }

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
    /** The winner gives its card and loses the turn's size until the ceremony hands it the lead. */
    resizesAfter: 1,
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
    resizesAfter: 0,
  },
] as const;

/** A press the hand reads as a tap: it measures the press on the clock this spec holds. */
async function press(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await step(page, 8 * 16);
  await page.mouse.up();
  await step(page);
}

/** The row in card widths, which moves with the slot count and not with the card's size. */
const slots = (s: Sample) => s.rowW / s.cardW;

for (const { role, save, resizesAfter } of ROLES) {
  test(`the ${role}'s hand row ends the ceremony as wide as the hand it settles into`, async ({ page, baseURL }) => {
    test.setTimeout(240_000);
    // On the real clock the resize's 120 ms can pass inside the one long task that commits it, so no
    // frame between its two sizes is ever painted (#1806, CI). Virtual time gives it its frames.
    await installVirtualClock(page, 1806);
    await page.addInitScript((key) => window.localStorage.setItem(key, "1"), E2E_REAL_EXCHANGE_KEY);
    await paintedFrames(page);
    await page.addInitScript((afterMs) => {
      const out: Sample[] = [];
      const w = window as unknown as { __rows: Sample[]; __settled?: boolean; murlanEachPaint: EachPaint };
      w.__rows = out;
      let began = false;
      let ended: number | null = null;
      const frame = () => {
        const t = performance.now();
        const ceremony = document.querySelector('[data-testid="exchange-announce"]') !== null;
        const row = document.querySelector<HTMLElement>('[data-testid="hand-row"]');
        const card = row?.querySelector<HTMLElement>('[data-testid^="hand-card-"]');
        if (ceremony) began = true;
        if (began && row && card) {
          const cardW = parseFloat(getComputedStyle(card).width);
          const m = new DOMMatrixReadOnly(getComputedStyle(card).transform);
          out.push({ t, ceremony, rowW: parseFloat(getComputedStyle(row).width), cardW, cardDrawn: cardW * Math.hypot(m.a, m.b) });
        }
        if (began && !ceremony && ended === null) ended = t;
        if (ended !== null && t - ended >= afterMs) {
          w.__settled = true;
          return false;
        }
      };
      w.murlanEachPaint(frame);
    }, AFTER_MS);
    // The seats play: the winner's size comes back with the lead the round hands it after the ceremony.
    await resumeOnVirtualClock(page, baseURL!, save(), undefined, { holdTurn: false });

    if (role === "winner") {
      const prompt = page.getByTestId("exchange-prompt");
      await stepUntil(page, () => prompt.isVisible(), "the exchange prompt", { chunkMs: 16 });
      await press(page, page.getByRole("button", { name: "5 di Cuori", exact: true }));
      await press(page, page.getByTestId("btn-gioca"));
    }
    const settledBy = Date.now() + 180_000;
    while (!(await stepThen<boolean>(page, 16, "window.__settled === true"))) {
      expect(Date.now(), "the ceremony and the half second after it ran").toBeLessThan(settledBy);
    }
    const rows = await page.evaluate(() => (window as unknown as { __rows: Sample[] }).__rows);

    const trace = rows
      .filter((s, i) => i === 0 || s.rowW !== rows[i - 1].rowW || s.cardW !== rows[i - 1].cardW)
      .map((s) => `${s.rowW.toFixed(2)}/${s.cardW.toFixed(3)}@${(s.t - rows[0].t).toFixed(0)}${s.ceremony ? "" : " after"}`)
      .join(", ");
    const during = rows.filter((s) => s.ceremony);
    const after = rows.slice(during.length);
    expect(during.length, "the ceremony was sampled").toBeGreaterThan(10);
    expect(after.every((s) => !s.ceremony), "the ceremony ran once, then the row was sampled after it").toBe(true);

    // The card has two sizes, off turn and on it, and nothing else resizes it, during the ceremony or after.
    const small = Math.min(...rows.map((s) => s.cardW));
    for (const s of rows) {
      const k = s.cardW / small;
      expect(Math.min(Math.abs(k - 1), Math.abs(k - TURN_RATIO)), `a card size that is not the turn's: ${trace}`).toBeLessThan(SIZE_TOLERANCE);
    }

    const resizes = rows.filter((s, i) => !s.ceremony && s.cardW !== rows[i - 1].cardW);
    expect(resizes.length, `size changes after the ceremony: ${trace}`).toBe(resizesAfter);
    for (const s of resizes) {
      const from = rows[rows.indexOf(s) - 1].cardW;
      expect(s.cardW / from, `the resize after the ceremony: ${trace}`).toBeCloseTo(TURN_RATIO, 3);
      const lo = Math.min(from, s.cardW);
      const margin = 0.05 * Math.abs(s.cardW - from);
      const between = after.filter((f) => f.t >= s.t && f.cardDrawn > lo + margin && f.cardDrawn < lo + Math.abs(s.cardW - from) - margin);
      expect(between.length, `the card is drawn between its two sizes on some frame: ${trace}`).toBeGreaterThan(0);
    }

    // The floor: the row steps by whole slots through the ceremony, so the equality below is not a
    // measure that never moves.
    const spread = Math.max(...during.map(slots)) - Math.min(...during.map(slots));
    expect(spread, `the row stepped a slot during the ceremony: ${trace}`).toBeGreaterThan(0.5);
    const last = during[during.length - 1];
    const settled = rows[rows.length - 1];
    expect(Math.abs(slots(last) - slots(settled)), `the last ceremony frame against the settled row: ${trace}`).toBeLessThan(SLOT_TOLERANCE);
  });
}
