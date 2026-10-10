// tests/e2e/resultCutout.spec.ts — nothing on the end-of-partita board falls under the display
// cutout, in either landscape rotation (#816, #1267).
//
// The owner once lost the result screen's whole left column — winner, name, verdict — under a
// notched iPhone's cutout. The board now sits on the felt, centred on it; this pins that its
// boxes land clear of the cutout once Yoga has read them, which no unit test can see.
//
// The insets are driven the way the app really reads them, the same way
// tests/e2e/controlRail.spec.ts drives the table's: react-native-safe-area-context
// appends a hidden probe div with `padding-*: env(safe-area-inset-*)` and
// reports the computed padding back on a `transitionend`, so overriding that
// padding walks the same path a real device does rather than mocking it.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openApp, startOfflineGame } from "./helpers/navigation";
import { driveGameToCompletion } from "./helpers/bot";
import { atRest } from "./helpers/settle";
import { seedRandomness } from "./helpers/seededRandomness";

const VIEWPORT = { width: 844, height: 390 };
const DEAL_SEED = 1;
const BOARD = '[data-testid="score-pill-layer"]';

/**
 * The vertical span a landscape cutout occupies — a centred bar on the short
 * edge, never the whole column. An iPhone X's notch is 209pt on a 390pt edge
 * and the Dynamic Island is smaller, so the notch is the worst case.
 * Deliberately the same share tests/e2e/controlRail.spec.ts uses.
 */
const CUTOUT_HEIGHT_SHARE = 209 / 390;

/** Layout rounds; a sub-pixel overlap is not something anyone can see. */
const TOLERANCE = 1;

interface Box {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function cutoutBand(viewportHeight: number): { top: number; bottom: number } {
  const h = viewportHeight * CUTOUT_HEIGHT_SHARE;
  return { top: (viewportHeight - h) / 2, bottom: (viewportHeight + h) / 2 };
}

/** Both horizontal insets at once — a rotation puts the cutout on either. */
async function setSafeArea(page: Page, side: number): Promise<void> {
  await page.evaluate((side) => {
    const id = "e2e-safe-area";
    document.getElementById(id)?.remove();
    const style = document.createElement("style");
    style.id = id;
    style.textContent =
      `div[style*="safe-area-inset-left"] {` +
      ` padding-left: ${side}px !important;` +
      ` padding-right: ${side}px !important;` +
      ` padding-bottom: 21px !important; }`;
    document.head.appendChild(style);
  }, side);
  // The probe transitions its padding over 0.05s and reports on transitionend.
  await page.waitForTimeout(600);
}

/** Every box on the board carrying something the player has to read or touch: a text leaf, and every control. */
async function boardBoxes(page: Page): Promise<Box[]> {
  return page.evaluate((board) => {
    const root = document.querySelector(board);
    if (!root) return [];
    const carriers = [
      ...root.querySelectorAll('[role="button"]'),
      ...[...root.querySelectorAll("*")].filter((el) => el.children.length === 0 && (el.textContent ?? "").trim().length > 0),
    ];
    return [...new Set(carriers)].flatMap((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return [];
      const label = el.getAttribute("aria-label") ?? el.getAttribute("data-testid") ?? (el.textContent ?? "").trim().slice(0, 30);
      return [{ label, x: r.x, y: r.y, width: r.width, height: r.height }];
    });
  }, BOARD);
}

test("the board keeps its content out of the cutout, on either edge", async ({ page, baseURL }) => {
  test.setTimeout(5 * 60_000);
  await page.setViewportSize(VIEWPORT);
  await seedRandomness(page, DEAL_SEED);
  await openApp(page, baseURL!);
  await startOfflineGame(page, { playerCount: 2, gameMode: "free_for_all", format: "single" });
  await driveGameToCompletion(page, {
    isFinished: (p) => p.getByTestId("btn-home").isVisible(),
    log: (line) => test.info().annotations.push({ type: "move", description: line }),
  });
  await atRest(page, BOARD);

  for (const cutout of [0, 44, 59]) {
    await setSafeArea(page, cutout);
    await atRest(page, BOARD);
    const boxes = await boardBoxes(page);
    expect(
      boxes.map((b) => b.label),
      "the winner's name was never measured, so the board is not in this sweep"
    ).toContain("partita-winner-name");

    const band = cutoutBand(VIEWPORT.height);
    const under = boxes.filter(
      (b) =>
        b.y < band.bottom &&
        b.y + b.height > band.top &&
        (b.x < cutout - TOLERANCE || b.x + b.width > VIEWPORT.width - cutout + TOLERANCE)
    );
    expect(
      under,
      `these run under the ${cutout}px cutout (y ${band.top}…${band.bottom}): ` +
        under.map((b) => `${b.label} at ${Math.round(b.x)},${Math.round(b.y)}`).join("; ")
    ).toEqual([]);
  }
});
