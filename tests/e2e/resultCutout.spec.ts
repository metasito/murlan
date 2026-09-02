// tests/e2e/resultCutout.spec.ts — nothing on the result screen falls under
// the display cutout, in either landscape rotation (#816).
//
// The owner lost the whole left column — winner avatar, winner name, WINS THE
// HAND, and the Hands / Target / Mode rows — under a notched iPhone's cutout.
// No unit test can see it: `react-test-renderer` runs no flexbox, so where a
// column actually ended up is a question only a browser answers.
// `tests/native/resultCutoutRail.test.tsx` pins the numbers the board hands
// out; this pins where the boxes land once Yoga has read them.
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
import { settled } from "./helpers/settle";

const RESULT_URL = /\/result/;
const VIEWPORT = { width: 844, height: 390 };

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

/**
 * Every box carrying something the player has to read or touch: a leaf that
 * holds text, and every control. Containers are deliberately left out — the
 * screen's own background spans the window by design, and counting it would
 * make this fail on a board that covers nothing at all.
 */
async function contentBoxes(page: Page): Promise<Box[]> {
  return page.evaluate(() => {
    const out: { label: string; x: number; y: number; width: number; height: number }[] = [];
    const seen = new Set<Element>();
    const carriers = [
      ...document.querySelectorAll('[role="button"], [role="heading"]'),
      ...[...document.querySelectorAll("*")].filter(
        (el) => el.children.length === 0 && (el.textContent ?? "").trim().length > 0
      ),
    ];
    for (const el of carriers) {
      if (seen.has(el)) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      out.push({
        label:
          el.getAttribute("aria-label") ??
          el.getAttribute("data-testid") ??
          (el.textContent ?? "").trim().slice(0, 30),
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      });
    }
    return out;
  });
}

/** The rail's own laid-out width — the column the cutout lives in. */
async function railWidth(page: Page): Promise<number> {
  const box = await page.locator('[data-testid="control-rail"]').boundingBox();
  if (!box) throw new Error("the result screen's control rail never rendered");
  return box.width;
}

test("the result screen keeps its own headline out of the cutout, on either edge", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(5 * 60_000);
  await page.setViewportSize(VIEWPORT);
  await openApp(page, baseURL!);
  await startOfflineGame(page, {
    playerCount: 2,
    gameMode: "free_for_all",
    format: "single",
  });
  await driveGameToCompletion(page, {
    isFinished: async (p) => RESULT_URL.test(p.url()),
    log: (line) => test.info().annotations.push({ type: "move", description: line }),
  });
  await expect(page).toHaveURL(RESULT_URL);
  // The rank rows enter from translateX(30), so a read taken through the
  // entrance measures the animation rather than the layout.
  await settled(page, 3000, '[data-testid="result-rankings"]');

  // ── A notchless phone. The rail's floor is what makes the notched layout
  //    below identical to this one, so it is the baseline both are read from.
  await setSafeArea(page, 0);
  await settled(page, 3000, '[data-testid="result-rankings"]');
  const bareRail = await railWidth(page);
  const bare = await contentBoxes(page);
  expect(bare.length, "nothing was measured at all, so this proves nothing").toBeGreaterThan(5);

  // The whole ticket: the winner's own column is what went under the cutout,
  // so it has to be among the boxes swept, or the sweep is looking elsewhere.
  expect(
    bare.map((b) => b.label),
    "the winner's name was never measured, so the covered content is not in this sweep"
  ).toContain("winner-celebration-name");

  // ── An iPhone X..14 notch. 44 + 12 clearance fits under the rail's floor,
  //    so the cutout appearing must move nothing.
  await setSafeArea(page, 44);
  await settled(page, 3000, '[data-testid="result-rankings"]');
  expect(await railWidth(page), "the rail's floor did not absorb a 44pt notch").toBe(bareRail);

  // ── A Dynamic Island, past the floor, so the column really does widen.
  await setSafeArea(page, 59);
  await settled(page, 3000, '[data-testid="result-rankings"]');
  const islandRail = await railWidth(page);
  expect(
    islandRail,
    "the rail never widened past its floor, so the sweep below proves nothing"
  ).toBeGreaterThan(bareRail);
  expect(islandRail).toBeGreaterThanOrEqual(59);

  for (const cutout of [44, 59]) {
    await setSafeArea(page, cutout);
    await settled(page, 3000, '[data-testid="result-rankings"]');
    const band = cutoutBand(VIEWPORT.height);
    const boxes = await contentBoxes(page);

    const inside = boxes.filter(
      (b) =>
        b.y < band.bottom &&
        b.y + b.height > band.top &&
        (b.x < cutout - TOLERANCE ||
          b.x + b.width > VIEWPORT.width - cutout + TOLERANCE)
    );
    expect(
      inside,
      `these run under the ${cutout}px cutout (rail is ${await railWidth(page)}px, the ` +
        `cutout spans y ${band.top}…${band.bottom}): ` +
        inside.map((b) => `${b.label} at ${Math.round(b.x)},${Math.round(b.y)}`).join("; ")
    ).toEqual([]);
  }
});
