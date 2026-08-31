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
    const hand = document.querySelector("[data-hand-state]");
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

/**
 * A card draws one outline: its own cut edge.
 *
 * Both the face and the back also carried a printed border a few points inside
 * that edge — a second rounded rectangle, symmetric in the DOM to the point of
 * a pixel. It still read as off-centre, because a card is not only its box: a
 * lit lip sits along the bottom edge and the drop shadow falls the same way, so
 * the *seen* card is a couple of points taller at the bottom than the box the
 * inner line was centred in. Two nested outlines is one more than a card has,
 * and the owner asked for the inner one gone (2026-08-31).
 *
 * Only a browser can count them: `react-test-renderer` never resolves a style
 * array into computed values, so a second border is invisible to a unit test.
 */
test("a card draws its own cut edge and nothing inside it", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(LARGE);
  await openSeededGame(page, baseURL!, 4);

  const outlines = await page.evaluate(() => {
    const out: { where: string; count: number }[] = [];
    for (const box of Array.from(document.querySelectorAll('[data-testid="card-box"]'))) {
      let count = 0;
      const walk = (n: Element) => {
        if ((parseFloat(getComputedStyle(n).borderTopWidth) || 0) > 0) count++;
        for (const k of Array.from(n.children)) walk(k);
      };
      walk(box);
      // SVG strokes drawn as a rounded rect inside the card count too — the
      // back's panel was one of those, not a CSS border.
      count += box.querySelectorAll("rect[rx]:not([fill]), rect[rx][fill='none']").length;
      out.push({ where: box.getAttribute("aria-label") ?? "?", count });
    }
    return out;
  });

  expect(outlines.length, "no card on the table to measure").toBeGreaterThan(0);
  for (const o of outlines) {
    expect(
      o.count,
      `${o.where} draws ${o.count} outlines — a card has one, its cut edge`
    ).toBeLessThanOrEqual(1);
  }
});
