// tests/e2e/homeCardField.spec.ts — the home screen's drifting cards, as they
// actually draw. tests/homeCardField.test.ts pins the composition's numbers;
// what only a rendered page settles is whether the component uses them — how
// many boxes exist at each orientation, what shape they came out, and whether
// the field is really out of the accessibility tree.
import { test, expect } from "@playwright/test";
import { openApp } from "./helpers/navigation";
import { CARD_H, CARD_W } from "../../components/cardFaceModel";

const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };
const CARDS = '[data-testid="floating-card"]';

/** Untransformed box: a tilted card's client rect is its own bounds rotated. */
async function boxes(page: import("@playwright/test").Page) {
  return page.locator(CARDS).evaluateAll((els) =>
    els.map((el) => {
      const s = getComputedStyle(el);
      return { w: parseFloat(s.width), h: parseFloat(s.height), left: el.getBoundingClientRect().left };
    })
  );
}

test("the card field draws six cards in portrait, at the face's own proportions", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize(PORTRAIT);
  await openApp(page, baseURL!);

  const drawn = await boxes(page);
  expect(drawn.length, "portrait does not draw six cards").toBe(6);

  const face = CARD_H(1) / CARD_W(1);
  for (const { w, h } of drawn) {
    expect(h / w, `a ${w}x${h} card is not card-shaped`).toBeCloseTo(face, 2);
  }

  // Three depth bands, so three sizes — one band drawn at another's size is a
  // field that reads flat however many opacities it uses.
  expect(new Set(drawn.map((b) => Math.round(b.w))).size, "the field draws fewer than three sizes").toBe(3);

  // Decoration: it must be in neither the accessibility tree nor the tab order.
  await expect(page.locator('[data-testid="card-field"]')).toHaveAttribute("aria-hidden", "true");
});

test("landscape drops to four cards, all of them clear of the menu column", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize(LANDSCAPE);
  await openApp(page, baseURL!);

  const drawn = await boxes(page);
  expect(drawn.length, "landscape does not draw four cards").toBe(4);
  for (const { left, w } of drawn) {
    expect(left + w, "a card drifts into the half the menu occupies").toBeLessThan(LANDSCAPE.width / 2);
  }
});
