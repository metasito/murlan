// tests/e2e/lampSeats.spec.ts — the lamp hangs over the seat on move, and the table stays legible.
//
// The lamp's pool centres on that seat's side of the felt, at the Lantern mockup's `POOL`, with the
// light 40 pt above it (#1257); the states come from `lib/captureStates.ts`, so this run and the
// iOS capture `app/capture.tsx` takes are of the same states. Chromium is the only renderer this
// spec reaches; `docs/agents/checks.md` has what that does and does not prove.
import { test, expect } from "@playwright/test";
import { openCaptureState } from "./helpers/offlineSeed";
import { tracedLamp } from "./helpers/tableTrace";
import { CAPTURE_STATES, CAPTURE_VIEWER_SEAT, captureGameState } from "../../lib/captureStates";
import { LIGHT_ABOVE, lampTarget } from "../../components/table/lampRig";

// The device the game is played on, at its landscape logical size, which is the design size.
const VIEWPORT = { width: 874, height: 402 };

/** The rig's resting sway, in design points. */
const SWAY = 20;

/** locales/it.ts `gameShared.turnOf` — the chip the lamp's own seat writes. */
const turnOf = (name: string) => `Turno di ${name}`;
const YOUR_TURN = "Il tuo turno";

for (const state of CAPTURE_STATES) {
  test(`the lamp hangs over the seat on move, and every seat and hand stay on screen: ${state.id}`, async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(VIEWPORT);
    await openCaptureState(page, baseURL!, state);

    // Past the deal stagger: every card is at opacity 0 until its own leg of it runs.
    await page.waitForTimeout(2_000);

    const seededName = captureGameState(state).players[state.turn].name;
    await expect(page.getByTestId("game-hud-stack")).toContainText(
      state.turn === CAPTURE_VIEWER_SEAT ? YOUR_TURN : turnOf(seededName)
    );

    const [poolX, poolY] = lampTarget(state.side);
    const lamp = await tracedLamp(page);
    expect(Math.abs(lamp.x - poolX), `the lamp's x over the ${state.side} seat`).toBeLessThanOrEqual(SWAY + 0.5);
    expect(lamp.y, `the lamp's height over the ${state.side} seat`).toBeCloseTo(poolY - LIGHT_ABOVE, 0);

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
