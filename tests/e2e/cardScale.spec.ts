// tests/e2e/cardScale.spec.ts — the card system's one scale (components/
// cardFaceModel.ts cardScale) is derived from the device's short edge at
// render time. No unit test can see that: CARD_W/CARD_H are pure functions
// of a number a test can hand them directly, but *which* number reaches them
// on a real device is a property of useWindowDimensions() and the DOM layout
// built from it — only a browser can measure that end to end.
import { test, expect } from "@playwright/test";
import { openSeededGame } from "./helpers/offlineSeed";

// Landscape-locked, so the short edge is the viewport height. 375 is a small
// phone; 834 is a tablet — the same spread tableFit.spec.ts exercises.
const SMALL = { width: 667, height: 375 };
const LARGE = { width: 1112, height: 834 };

/**
 * The first hand card's rendered width. `card-box` rather than the pressable
 * around it: in a hand the pressable is only the strip the card exposes, which
 * is set by how many cards are held, not by the scale this measures.
 */
async function firstHandCardWidth(page: import("@playwright/test").Page): Promise<number> {
  const width = await page.evaluate(() => {
    const hand = document.querySelector('[aria-label^="La tua mano"]');
    if (!hand) throw new Error("the hand never rendered");
    const box = hand.querySelector('[data-testid="card-box"]');
    return box ? box.getBoundingClientRect().width : null;
  });
  if (width === null) throw new Error("no hand card rendered");
  return width;
}

test.describe("card size follows the viewport's short edge", () => {
  test("a bigger short edge draws a bigger card, roughly in proportion", async ({ page, baseURL }) => {
    test.setTimeout(90_000);

    await page.setViewportSize(SMALL);
    await openSeededGame(page, baseURL!, 4);
    await page.waitForTimeout(1_000);
    const small = await firstHandCardWidth(page);

    await page.setViewportSize(LARGE);
    await page.waitForTimeout(1_000);
    const large = await firstHandCardWidth(page);

    expect(large, `card did not grow: ${small}px at ${SMALL.height}px short edge, ${large}px at ${LARGE.height}px`)
      .toBeGreaterThan(small);

    // cardScale is linear in the short edge with no breakpoints, so the width
    // ratio should track the short-edge ratio — loosely, since layout rounds
    // to whole pixels and the hand's own overlap step (not the card's own
    // width) is what may compress on a narrow screen.
    const shortEdgeRatio = LARGE.height / SMALL.height;
    const widthRatio = large / small;
    expect(
      widthRatio,
      `width ratio ${widthRatio.toFixed(2)} does not track the short-edge ratio ${shortEdgeRatio.toFixed(2)}`
    ).toBeGreaterThan(shortEdgeRatio * 0.7);
  });
});
