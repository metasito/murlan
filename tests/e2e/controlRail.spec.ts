// tests/e2e/controlRail.spec.ts — the cutout column is a control rail.
//
// A cutout can never sit on a card, but it sits happily between two controls,
// so the column it occupies holds the menu knob at the head and the reactions
// knob at the foot. Two things have to hold, and neither is visible to a unit
// test: nothing the player has to see or touch may render inside the cutout's
// own rect, and a cutout that fits under the rail's floor must move nothing.
//
// The insets are driven the way the app really reads them. On web
// react-native-safe-area-context appends a hidden probe div to <body> with
// `padding-*: env(safe-area-inset-*)` and reports the computed padding back on
// a `transitionend` — so overriding that padding is a real end-to-end drive of
// the same path a notched iPhone takes, not a mock.
import { test, expect, type Page } from "@playwright/test";
import { openSeededGame } from "./helpers/offlineSeed";

const VIEWPORT = { width: 844, height: 390 };

/** Every box a player has to see or touch, by its own left/right edges. */
interface Box {
  label: string;
  /** Exact left edge, for the cutout check. */
  left: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

async function tableBoxes(page: Page): Promise<Box[]> {
  return page.evaluate(() => {
    const table = document.querySelector('[data-testid="game-table"]');
    if (!table) throw new Error("the table never rendered");
    const out: {
      label: string;
      left: number;
      x: number;
      y: number;
      width: number;
      height: number;
    }[] = [];
    const seen = new Set<Element>();
    // Cards and controls: everything a cutout would sit on top of. The rail's
    // own knobs are included deliberately — they must sit clear of it too.
    for (const el of document.querySelectorAll('[role="button"], [data-testid^="btn-"]')) {
      if (seen.has(el)) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Whole pixels: layout rounds, and a sub-pixel difference is not a
      // shift anyone can see. `x` is kept exact for the cutout check below.
      out.push({
        label: el.getAttribute("aria-label") ?? el.getAttribute("data-testid") ?? "control",
        left: r.x,
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label) || a.x - b.x);
  });
}

/**
 * Overrides the safe-area probe's padding, so the app reads the insets a
 * landscape iPhone reports. The probe is the only element in the document
 * whose inline style names `safe-area-inset-left`, and its own 0.05s padding
 * transition is what fires the library's `onInsetsChange`.
 */
async function setSafeArea(page: Page, left: number, bottom: number): Promise<void> {
  await page.evaluate(
    ({ left, bottom }) => {
      const id = "e2e-safe-area";
      document.getElementById(id)?.remove();
      const style = document.createElement("style");
      style.id = id;
      style.textContent =
        `div[style*="safe-area-inset-left"] {` +
        ` padding-left: ${left}px !important;` +
        ` padding-right: 21px !important;` +
        ` padding-bottom: ${bottom}px !important; }`;
      document.head.appendChild(style);
    },
    { left, bottom }
  );
  // The probe transitions its padding over 0.05s and reports on transitionend.
  await page.waitForTimeout(600);
}

/**
 * The boxes once they have stopped moving. A card carries a spring — the
 * deal, and the lift a selection rides — so a read taken the moment the insets
 * change is a read mid-flight. Sampling until two consecutive reads agree
 * waits for the animation itself rather than for a guessed duration.
 */
async function settledBoxes(page: Page): Promise<Box[]> {
  let previous: string | null = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    const boxes = await tableBoxes(page);
    const key = JSON.stringify(boxes);
    if (key === previous) return boxes;
    previous = key;
    await page.waitForTimeout(150);
  }
  throw new Error("the table never settled into a stable layout");
}

/**
 * The vertical span a landscape cutout occupies. It is a bar on the short
 * edge, centred, never the whole column — which is the entire reason two
 * knobs can share the column with it. An iPhone X's notch is 209pt on a
 * 390pt edge; the Dynamic Island is smaller, so the notch is the worst case.
 */
const CUTOUT_HEIGHT_SHARE = 209 / 390;

function cutoutBand(viewportHeight: number): { top: number; bottom: number } {
  const h = viewportHeight * CUTOUT_HEIGHT_SHARE;
  return { top: (viewportHeight - h) / 2, bottom: (viewportHeight + h) / 2 };
}

/** The rail's own laid-out width — the column the cutout lives in. */
async function railWidth(page: Page): Promise<number> {
  const box = await page.locator('[data-testid="control-rail"]').boundingBox();
  if (!box) throw new Error("the control rail never rendered");
  return box.width;
}

test.describe("the control rail", () => {
  test("keeps every card and control out of the cutout, and does not shift under one", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(VIEWPORT);
    await openSeededGame(page, baseURL!, 4);
    await page.waitForTimeout(1_500);

    // ── A notchless phone, on the same home-indicator inset as the notched
    //    one below: only the cutout may vary between the two samples.
    await setSafeArea(page, 0, 21);
    const bare = await settledBoxes(page);
    const bareRail = await railWidth(page);
    expect(bare.length, "no cards or controls were measured at all").toBeGreaterThan(5);

    // ── An iPhone X..14 notch. 44 + 12 clearance still fits under the floor,
    //    so the cutout appearing must move nothing.
    await setSafeArea(page, 44, 21);
    const exact = (boxes: Box[]) => boxes.map(({ left: _left, ...rest }) => rest);
    const notched = await settledBoxes(page);
    expect(await railWidth(page), "the rail's floor did not absorb a 44pt notch").toBe(bareRail);
    expect(
      exact(notched),
      "the layout shifted when the cutout appeared — it was never sized for it"
    ).toEqual(exact(bare));

    // ── A Dynamic Island. Wider than the floor, so the rail widens with it —
    //    and nothing may be drawn inside the column it now reserves.
    await setSafeArea(page, 59, 21);
    const islandRail = await railWidth(page);
    expect(
      islandRail,
      "the rail did not widen for an inset past its floor, so this proves nothing"
    ).toBeGreaterThan(bareRail);
    expect(islandRail).toBeGreaterThanOrEqual(59);

    for (const cutout of [44, 59]) {
      await setSafeArea(page, cutout, 21);
      const rail = await railWidth(page);
      const band = cutoutBand(VIEWPORT.height);
      const boxes = await settledBoxes(page);

      // The floor: if nothing were laid out inside the rail's own column, the
      // sweep below would be empty and pass having looked at nothing. The two
      // knobs are exactly what has to clear the cutout, so they must be here.
      const onRail = boxes.filter((b) => b.left < rail);
      expect(
        onRail.map((b) => b.label),
        "no control is laid out on the rail at all, so this check sees nothing"
      ).not.toEqual([]);

      const inside = boxes.filter(
        (b) => b.left < cutout && b.y < band.bottom && b.y + b.height > band.top
      );
      expect(
        inside,
        `these intersect the ${cutout}px cutout (rail is ${rail}px, cutout spans ` +
          `y ${band.top}…${band.bottom}): ` +
          inside.map((b) => `${b.label} at ${b.left},${b.y}`).join("; ")
      ).toEqual([]);
    }
  });
});
