// tests/e2e/seatsDoNotMove.spec.ts — no seat ring and not the pile moves as hands shrink or a seat goes out (#1259, #13).
import { test, expect, type Page } from "@playwright/test";
import { openCaptureState } from "./helpers/offlineSeed";
import { PHONES } from "./helpers/phones";
import { CAPTURE_VIEWER_SEAT, SEAT_COUNT_STATES, captureGameState, type CaptureState } from "../../lib/captureStates";
import { FAN_DRAWN_CARDS, seatDirection, type OpponentSide } from "../../components/seatLayout";

const TOLERANCE_PT = 0.5;
const SEATS: readonly (readonly [OpponentSide, string])[] = [
  ["top", "top-seat"],
  ["left", "side-seat-left"],
  ["right", "side-seat-right"],
];

type Point = { x: number; y: number };
type Places = Record<OpponentSide | "pile", Point | null>;

function seeded(state: CaptureState): Record<OpponentSide, { backs: number; out: boolean }> {
  const game = captureGameState(state);
  const out = {} as Record<OpponentSide, { backs: number; out: boolean }>;
  game.players.forEach((p, seat) => {
    const dir = seatDirection(seat, CAPTURE_VIEWER_SEAT, game.players.length);
    if (dir === "bottom") return;
    const done = p.finishPosition !== undefined;
    out[dir] = { backs: done ? 0 : Math.min(p.hand.length, FAN_DRAWN_CARDS[dir]), out: done };
  });
  return out;
}

function places(page: Page): Promise<Places> {
  return page.evaluate((seats) => {
    const centre = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const out: Record<string, { x: number; y: number } | null> = {
      pile: centre(document.querySelector('[data-testid="pile-area"]')),
    };
    for (const [side, id] of seats) out[side] = centre(document.querySelector(`[data-testid="${id}"] [data-testid="seat-ring"]`));
    return out as Places;
  }, SEATS);
}

async function settledPlaces(page: Page): Promise<Places> {
  let previous = "";
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await places(page));
        const still = now === previous;
        previous = now;
        return still;
      },
      { message: "the rings and the pile never came to rest", timeout: 15_000, intervals: [150] }
    )
    .toBe(true);
  return places(page);
}

async function openSeeded(page: Page, baseURL: string, state: CaptureState): Promise<Places> {
  await openCaptureState(page, baseURL, state);
  for (const [side, id] of SEATS) {
    const want = seeded(state)[side];
    await expect(page.locator(`[data-testid="${id}"] [data-testid="seat-back"]`), `${state.id}: the ${side} seat's drawn backs`).toHaveCount(
      want.backs,
      { timeout: 15_000 }
    );
    await expect(page.locator(`[data-testid="${id}"] [data-testid="seat-finish-trophy"]`), `${state.id}: the ${side} seat's trophy`).toHaveCount(
      want.out ? 1 : 0
    );
  }
  return settledPlaces(page);
}

for (const phone of PHONES) {
  test(`every ring and the pile stay where the deal put them: ${phone.name}`, async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: phone.width, height: phone.height });
    const [deal, ...rest] = SEAT_COUNT_STATES;
    const at = await openSeeded(page, baseURL!, deal);
    for (const state of rest) {
      const now = await openSeeded(page, baseURL!, state);
      for (const what of ["top", "left", "right", "pile"] as const) {
        const [was, is] = [at[what], now[what]];
        const name = what === "pile" ? "the pile" : `the ${what} ring`;
        expect(was, `${deal.id}: ${name} is not drawn`).not.toBeNull();
        expect(is, `${state.id}: ${name} is not drawn`).not.toBeNull();
        for (const axis of ["x", "y"] as const) {
          expect(Math.abs(is![axis] - was![axis]), `${state.id}: ${name} moved along ${axis}`).toBeLessThanOrEqual(TOLERANCE_PT);
        }
      }
    }
  });
}
