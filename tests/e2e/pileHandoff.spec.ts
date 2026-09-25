// tests/e2e/pileHandoff.spec.ts — a thrown combination lands where the pile then draws it.
//
// `FlyingCards` and `PlayedPile` are two layers drawing the same cards in turn, so a difference in
// their layout is a jump the moment the flight hands over; only a browser runs the flexbox.
import { test, expect } from "@playwright/test";
import { openSeededGame } from "./helpers/offlineSeed";

const VIEWPORT = { width: 844, height: 390 };
const OPPONENT_TURN = 1;

type Centre = { x: number; y: number };

test("a bot's thrown cards come to rest where the pile then draws them", async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    const w = window as unknown as { __lastFlight: Centre[] | null };
    w.__lastFlight = null;
    const centres = (root: Element) =>
      [...root.querySelectorAll('[data-testid="card-box"]')].map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
    const sample = () => {
      const flight = document.querySelector('[data-testid="flying-cards"]');
      if (flight) w.__lastFlight = centres(flight);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  await openSeededGame(page, baseURL!, 4, undefined, OPPONENT_TURN, true);
  await page.evaluate(() => (globalThis as unknown as { murlanBotMove: () => void }).murlanBotMove());
  await page.locator('[data-testid="flying-cards"]').waitFor({ state: "attached", timeout: 15_000 });
  await page.locator('[data-testid="flying-cards"]').waitFor({ state: "detached", timeout: 15_000 });
  await page.waitForTimeout(1_500);

  const { flight, pile } = await page.evaluate(() => ({
    flight: (window as unknown as { __lastFlight: Centre[] | null }).__lastFlight,
    pile: [...document.querySelectorAll('[data-testid="pile-area"] [data-testid="card-box"]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }),
  }));

  expect(flight, "a frame of the flight was sampled").not.toBeNull();
  expect(pile.length, "the pile draws the thrown cards").toBe(flight!.length);
  pile.forEach((p, i) => {
    const moved = Math.hypot(p.x - flight![i].x, p.y - flight![i].y);
    expect(moved, `card ${i} moved ${moved.toFixed(1)}px from its landing to the pile`).toBeLessThan(1);
  });
});
