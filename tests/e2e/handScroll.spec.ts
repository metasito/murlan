// tests/e2e/handScroll.spec.ts — a hand too wide for the phone, under a
// finger (#531).
//
// A two-player deal gives a seat 21 cards. On the smallest real phone that is a
// 543px row in a 357px window, so a third of the hand is out of sight and has
// to be brought in. Reaching for it and rearranging it are then two things one
// finger has to mean.
//
// Only a real touch can tell them apart. Attaching a gesture to the row makes
// react-native-gesture-handler write `touch-action: none` onto it
// (`GestureHandlerWebDelegate.js:103`), which stops a browser scrolling it;
// `pan-x`, the obvious remedy, hands the browser the finger and the drag stops
// reordering. Both were measured, and a mouse — which `touch-action` says
// nothing about — passes either way. So the gesture arbitrates instead, and
// these two tests are the two answers it has to keep giving.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openSeededGame } from "./helpers/offlineSeed";
import { HAND_CARDS, TABLE } from "./helpers/selectors";

/** iPhone SE landscape — the smallest real phone, and the worst case. */
const VIEWPORT = { width: 568, height: 320 };
/** What a two-seat deal actually gives one player (`dealCards(2)`). */
const MAX_HAND = 21;
/** Past `HOLD_MS` in components/table/hand.tsx, with room for a slow runner. */
const HELD_MS = 800;

interface HandCard {
  label: string;
  x: number;
  y: number;
}

/** The hand as it is actually laid out, left to right — clipped cards included. */
async function handRow(page: Page): Promise<HandCard[]> {
  const found: HandCard[] = [];
  for (const card of await page.locator(HAND_CARDS).all()) {
    const box = await card.boundingBox();
    const label = await card.getAttribute("aria-label");
    if (box && label) found.push({ label, x: box.x, y: box.y + box.height / 2 });
  }
  return found.sort((a, b) => a.x - b.x);
}

/**
 * The window the row is moved under: the clipping box, and how much row is
 * hidden. A finger outside it lands on the felt, which is how this spec spent
 * three runs measuring nothing.
 */
async function handWindow(page: Page): Promise<{ left: number; right: number; hidden: number }> {
  const found = await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll("div"))) {
      const child = el.firstElementChild;
      if (child === null || getComputedStyle(el).overflow !== "hidden") continue;
      const win = el.getBoundingClientRect();
      const row = child.getBoundingClientRect();
      if (row.width > win.width + 1) {
        return { left: win.left, right: win.right, hidden: row.width - win.width };
      }
    }
    return null;
  });
  expect(
    found,
    "no clipped row — this viewport did not overflow, so nothing here is under test"
  ).not.toBeNull();
  return found!;
}

/**
 * A finger, through CDP. `page.touchscreen` taps and does not drag, and
 * `page.mouse` is not a finger: `touch-action` governs touch alone, so a mouse
 * would pass these whatever the CSS did.
 */
async function finger(
  page: Page,
  { from, to, y, holdMs }: { from: number; to: number; y: number; holdMs: number }
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: "touchStart" | "touchEnd" | "touchMove", x: number) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      // A stable id, or Chromium reads each move as a new finger arriving.
      touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1, radiusX: 6, radiusY: 6, force: 1 }],
    });

  await send("touchStart", from);
  if (holdMs > 0) await page.waitForTimeout(holdMs);
  // In steps, not one jump: both the row's travel and the drop slot are read
  // from where the finger is, and one sample is one decision.
  // Paced: Chromium coalesces synthetic touch moves sent back to back, and a
  // drag that arrives as two samples measures two samples.
  for (let i = 1; i <= 16; i++) {
    await send("touchMove", from + ((to - from) * i) / 16);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(100);
  await send("touchEnd", to);
  await page.waitForTimeout(400);
}

async function openBigHand(page: Page, baseURL: string): Promise<HandCard[]> {
  await page.setViewportSize(VIEWPORT);
  await openSeededGame(page, baseURL, 2, MAX_HAND);
  await page.locator(TABLE).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1_500);
  const row = await handRow(page);
  expect(row.length, "the seeded hand rendered no cards").toBeGreaterThan(4);
  return row;
}

test.use({ hasTouch: true });

test.describe("a hand wider than the phone", () => {
  test("moves under a finger that has not held anything", async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    const before = await openBigHand(page, baseURL!);
    const win = await handWindow(page);

    // No hold in front of it: a player reaching for the far end of their own
    // hand, which has to move the row rather than a card.
    const travel = Math.min(win.hidden / 2, (win.right - win.left) / 3);
    await finger(page, {
      from: win.right - 20,
      to: win.right - 20 - travel,
      y: before[0].y,
      holdMs: 0,
    });

    const after = await handRow(page);
    expect(
      after.map((c) => c.label),
      "a finger that never held anything rearranged the hand"
    ).toEqual(before.map((c) => c.label));
    // That it moved, not how far: Chromium delivers a synthetic drag as a
    // fraction of the moves it is sent, so the distance here measures the
    // harness. The row tracks the finger one-to-one over what does arrive.
    expect(
      before[0].x - after[0].x,
      `the row did not move under the finger (first card ${before[0].x} → ${after[0].x}), so the ` +
        `${Math.round(win.hidden)}px of hand outside the window cannot be reached`
    ).toBeGreaterThan(20);
  });

  test("still reorders under a finger that held first", async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    const before = await openBigHand(page, baseURL!);
    const win = await handWindow(page);

    // The leftmost card the window actually shows, dragged to the right-hand
    // end of what is on screen.
    const held = before.find((c) => c.x > win.left + 8);
    expect(held, "no card is inside the hand's own window").toBeDefined();
    await finger(page, {
      from: held!.x + 4,
      to: win.right - 12,
      y: held!.y,
      holdMs: HELD_MS,
    });

    const after = await handRow(page);
    const labels = after.map((c) => c.label);
    expect(labels, "a card was lost or duplicated by the drag").toHaveLength(before.length);
    expect(
      labels.indexOf(held!.label),
      `a finger held ${held!.label} and dragged it right, and the hand reads ${labels.join(", ")}`
    ).toBeGreaterThan(before.map((c) => c.label).indexOf(held!.label));
  });
});
