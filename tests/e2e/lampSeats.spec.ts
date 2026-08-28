// tests/e2e/lampSeats.spec.ts — the table is legible on somebody else's turn.
//
// The lamp swings to the seat on move, and everything the felt does — the
// falloff, the seats dimming, the action buttons going dark — is keyed off
// that. Every capture this suite took before this spec seeded the turn on the
// viewer's own seat, so the lamp was only ever photographed at the bottom edge
// and the three states where it is anywhere else went unchecked.
//
// The states come from `lib/captureStates.ts` rather than from a list here, so
// this run and the iOS capture `app/capture.tsx` takes are of the same states
// rather than of two similar ones. Chromium is the only renderer this spec
// reaches; `docs/agents/loops.md` has what that does and does not prove.
import { test, expect } from "@playwright/test";
import { openCaptureState } from "./helpers/offlineSeed";
import { CAPTURE_STATES, CAPTURE_VIEWER_SEAT, captureGameState } from "../../lib/captureStates";

// The device the game is played on, at its landscape logical size.
const VIEWPORT = { width: 874, height: 402 };

// The viewer's own turn is the state every capture already took; what went
// unchecked is the lamp anywhere else.
const AWAY = CAPTURE_STATES.filter((s) => s.turn !== CAPTURE_VIEWER_SEAT);

/** locales/it.ts `gameShared.turnOf` — the chip the lamp's own seat writes. */
const turnOf = (name: string) => `Turno di ${name}`;

for (const state of AWAY) {
  test(`the lamp holds the seeded seat, and every seat and hand stay on screen: ${state.id}`, async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(VIEWPORT);
    await openCaptureState(page, baseURL!, state);

    // Past the deal stagger: every card is at opacity 0 until its own leg of
    // it runs, so a frame taken during the deal shows an empty table and
    // proves nothing about the felt.
    await page.waitForTimeout(2_000);

    // The chip is the one thing on screen that moves with the lamp; the
    // geometry below it does not.
    const seededName = captureGameState(state).players[state.turn].name;
    await expect(page.getByTestId("game-hud-stack")).toContainText(turnOf(seededName));

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
        cards: rects('[data-hand-state] [data-testid="card-box"]'),
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
