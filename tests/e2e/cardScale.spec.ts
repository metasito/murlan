// tests/e2e/cardScale.spec.ts — the card system's one scale (components/
// cardFaceModel.ts cardScale) is derived from the device's short edge at
// render time. No unit test can see that: CARD_W/CARD_H are pure functions
// of a number a test can hand them directly, but *which* number reaches them
// on a real device is a property of useWindowDimensions() and the DOM layout
// built from it — only a browser can measure that end to end.
import { test, expect } from "@playwright/test";
import { DEAL_SIZE, openSeededGame } from "./helpers/offlineSeed";

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
 * A card is bounded by one line: its own cut edge.
 *
 * The rule is about *frames*, not about decoration — a court panel and a
 * joker's marotte are strokes inside a card and belong there. What must not
 * exist is a second line following the card's whole outline a few points in,
 * because a card is not only its box: the lit lip runs along the bottom edge
 * alone and the drop shadow falls the same way, so a line centred in the box
 * sits high in the card anyone actually looks at.
 *
 * Measured by geometry rather than by tag, so it holds however the line is
 * drawn — a CSS border, an SVG rect, a path. Only a browser resolves any of
 * that: `react-test-renderer` never computes a style array.
 */
/** How much of the card a line has to span before it is a frame around it. */
const FRAME_SPAN = 0.82;

test("a card is bounded by its cut edge alone, face and back", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(LARGE);
  // A full deal, so every rank is on the table — the jokers included, whose
  // court panel is exactly the interior stroke this must not mistake for a
  // frame. The opponents' fans are the only backs a table shows.
  await openSeededGame(page, baseURL!, 4, DEAL_SIZE[4]);
  await page.waitForTimeout(1_500);

  const cards = await page.evaluate((span: number) => {
    const out: { kind: string; card: string; frames: number }[] = [];
    for (const box of Array.from(document.querySelectorAll('[data-testid^="card-box"]'))) {
      const card = box.getBoundingClientRect();
      if (card.width === 0) continue;
      let frames = 0;
      for (const n of Array.from(box.querySelectorAll("*"))) {
        const st = getComputedStyle(n);
        // A CSS border, or a stroked rectangle with nothing in it. Not a
        // <path>: the back's lattice is drawn as one path across the whole card
        // and is texture, not an outline — counting it would make every back
        // fail for the thing that gives it its pattern.
        const draws =
          (parseFloat(st.borderTopWidth) || 0) > 0 ||
          (n.tagName.toLowerCase() === "rect" && st.fill === "none" && st.stroke !== "none" && st.stroke !== "");
        if (!draws || st.opacity === "0" || st.visibility === "hidden") continue;
        const r = n.getBoundingClientRect();
        if (r.width >= card.width * span && r.height >= card.height * span) frames++;
      }
      out.push({
        kind: box.getAttribute("data-testid") ?? "?",
        card: box.closest("[aria-label]")?.getAttribute("aria-label") ?? "a face-down card",
        frames,
      });
    }
    return out;
  }, FRAME_SPAN);

  // The floor: without both kinds on screen this passes by measuring nothing.
  expect(
    cards.filter((c) => c.kind === "card-box").length,
    "no card face on the table to measure"
  ).toBeGreaterThan(0);
  expect(
    cards.filter((c) => c.kind === "card-box-back").length,
    "no card back on the table to measure"
  ).toBeGreaterThan(0);

  // The cut edge is the box itself, so anything counted here is a second one.
  for (const c of cards) {
    expect(
      c.frames,
      `${c.card} carries ${c.frames} line(s) round it inside its own cut edge — it should carry none`
    ).toBe(0);
  }
});
