// tests/e2e/lampSeats.spec.ts — the table is legible on somebody else's turn.
//
// The lamp swings to the seat on move, and everything the felt does — the
// falloff, the seats dimming, the action buttons going dark — is keyed off
// that. Every capture this suite took before this spec seeded the turn on the
// viewer's own seat, so the lamp was only ever photographed at the bottom edge
// and the three states where it is anywhere else went unchecked.
import { test, expect } from "@playwright/test";
import { openSeededGame, DEAL_SIZE } from "./helpers/offlineSeed";

// The device the game is played on, at its landscape logical size.
const VIEWPORT = { width: 874, height: 402 };

/** Seat 0 is the viewer; 1..3 are the top and the two side seats. */
for (const turn of [1, 2, 3]) {
  test(`every seat and the hand stay on screen with the lamp on seat ${turn}`, async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(VIEWPORT);
    await openSeededGame(page, baseURL!, 4, DEAL_SIZE[4], turn);

    // Past the deal stagger: every card is at opacity 0 until its own leg of
    // it runs, so a frame taken during the deal shows an empty table and
    // proves nothing about the felt.
    await page.waitForTimeout(2_000);

    const boxes = await page.evaluate(() => {
      const rects = (sel: string) =>
        [...document.querySelectorAll(sel)].map((el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width };
        });
      return {
        seats: rects(
          '[data-testid="top-seat"], [data-testid="side-seat-left"], [data-testid="side-seat-right"]'
        ),
        cards: rects('[aria-label^="La tua mano"] [data-testid="card-box"]'),
      };
    });

    expect(boxes.cards.length, "the viewer's own hand did not render").toBeGreaterThan(0);
    for (const c of boxes.cards) {
      expect(c.right, `a hand card sits off the left edge`).toBeGreaterThan(0);
      expect(c.left, `a hand card sits off the right edge`).toBeLessThan(VIEWPORT.width);
      expect(c.top, `a hand card sits below the bottom edge`).toBeLessThan(VIEWPORT.height);
    }
    expect(boxes.seats, "a four-player table draws three opponents").toHaveLength(3);
    for (const s of boxes.seats) {
      expect(s.w, "a seat rendered with no width").toBeGreaterThan(0);
      expect(s.right).toBeGreaterThan(0);
      expect(s.left).toBeLessThan(VIEWPORT.width);
    }
  });
}
