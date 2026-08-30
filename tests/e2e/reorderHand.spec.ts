// tests/e2e/reorderHand.spec.ts — a player arranges their own hand (#531).
//
// The only tier that can see this. `react-test-renderer` never runs flexbox, so
// nothing in the native suite can say where a card ended up; the arithmetic
// under the gesture is covered by `tests/handOrder.test.ts`, and what is left —
// that a hold picks a card up, that a drag puts it where the finger let go, and
// that a plain tap still only selects — is a property of a laid-out row under a
// real pointer.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openSeededGame } from "./helpers/offlineSeed";
import { HAND_CARDS, TABLE } from "./helpers/selectors";

const VIEWPORT = { width: 844, height: 390 };
/** Past `HOLD_MS` in components/table/hand.tsx, with room for a slow runner. */
const HOLD_MS = 800;

interface HandCard {
  label: string;
  x: number;
  y: number;
}

/** The viewer's hand as it is actually laid out, left to right. */
async function handRow(page: Page): Promise<HandCard[]> {
  const cards = await page.locator(HAND_CARDS).all();
  const row: HandCard[] = [];
  for (const card of cards) {
    const box = await card.boundingBox();
    const label = await card.getAttribute("aria-label");
    if (!box || !label) continue;
    row.push({ label, x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }
  return row.sort((a, b) => a.x - b.x);
}

const labels = (row: HandCard[]) => row.map((c) => c.label);

/** Presses at `from`, holds past the threshold, drags to `toX` and lets go. */
async function dragCard(page: Page, from: HandCard, toX: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.waitForTimeout(HOLD_MS);
  // In steps, not in one jump: the drop slot is read from where the finger is,
  // and a single move gives the gesture one sample to decide on.
  await page.mouse.move(toX, from.y, { steps: 16 });
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(400);
}

test.describe("arranging your own hand", () => {
  test("a held card lands where the finger let go, and stays there", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(VIEWPORT);
    await openSeededGame(page, baseURL!, 2);
    await page.locator(TABLE).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1_500);

    const before = await handRow(page);
    expect(before.length, "the seeded hand rendered no cards").toBeGreaterThan(4);

    const first = before[0];
    const last = before[before.length - 1];
    await dragCard(page, first, last.x + 40);

    const after = await handRow(page);
    expect(
      labels(after),
      `the hand holds different cards than it did: ${labels(after).join(", ")}`
    ).toHaveLength(before.length);
    expect(
      new Set(labels(after)).size,
      "a card appears more than once after the drag"
    ).toBe(before.length);
    expect(
      labels(after)[after.length - 1],
      `dragged ${first.label} to the right-hand end and the hand reads ${labels(after).join(", ")}`
    ).toBe(first.label);

    // …and it is an arrangement, not a one-frame animation: the engine's own
    // order is reapplied on every render, so a card that only appeared to move
    // is back where it started by the next one.
    await page.waitForTimeout(1_000);
    expect(labels(await handRow(page))).toEqual(labels(after));
  });

  test("works when it is not the viewer's turn", async ({ page, baseURL }) => {
    // The point of the feature, in the owner's own words: "even when it's not
    // their turn". Waiting is when a player has time to arrange a hand.
    test.setTimeout(120_000);
    await page.setViewportSize(VIEWPORT);
    await openSeededGame(page, baseURL!, 2, undefined, 1, true);
    await page.locator(TABLE).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1_500);

    const before = await handRow(page);
    expect(before.length, "the seeded hand rendered no cards").toBeGreaterThan(4);
    await dragCard(page, before[0], before[before.length - 1].x + 40);

    const after = await handRow(page);
    expect(
      labels(after)[after.length - 1],
      `off turn, dragging ${before[0].label} to the end left the hand as ${labels(after).join(", ")}`
    ).toBe(before[0].label);
  });

  test("a plain tap still only selects", async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(VIEWPORT);
    await openSeededGame(page, baseURL!, 2);
    await page.locator(TABLE).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1_500);

    const before = await handRow(page);
    await page.mouse.click(before[0].x, before[0].y);
    await page.waitForTimeout(400);

    expect(labels(await handRow(page)), "a tap moved a card").toEqual(labels(before));
    // A card is a toggle button rather than a listbox option, so selection
    // reaches the DOM as `aria-pressed` (`a11yState`, lib/a11y.tsx).
    await expect(
      page.locator(`${HAND_CARDS}[aria-pressed="true"]`),
      "a tap did not select the card it landed on"
    ).toHaveCount(1);
  });

});
