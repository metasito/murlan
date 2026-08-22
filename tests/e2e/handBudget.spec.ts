// tests/e2e/handBudget.spec.ts — the hand meets the bottom edge, and every arc
// gets a width budget.
//
// Your hand runs to the device's bottom edge and is cropped by it, which buys
// the table height while keeping the cards big: a card's index is at its
// top-left, so only the redundant upside-down copy at the foot is lost. Gioca
// and Passa are not cropped — they sit on the safe line, clear of the home
// indicator. And no arc takes all the room it can reach.
//
// Every one of those is a property of a laid-out box against the viewport, so
// react-test-renderer cannot see any of it.
import { test, expect, type Page } from "@playwright/test";
import { openSeededGame } from "./helpers/offlineSeed";

const VIEWPORT = { width: 844, height: 390 };

/** Every hand card's rect, left to right. */
async function handCards(page: Page) {
  return page.evaluate(() => {
    const hand = document.querySelector('[aria-label^="La tua mano"]');
    if (!hand) throw new Error("the hand never rendered");
    // `card-box`, not the pressable: in a hand the pressable is only the strip
    // the card exposes, and what is drawn is what this measures.
    return [...hand.querySelectorAll('[data-testid="card-box"]')]
      .map((el) => el.getBoundingClientRect())
      .map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }))
      .sort((a, b) => a.left - b.left);
  });
}

test.describe("the hand's own budget", () => {
  test("meets the bottom edge, keeps the buttons off it, and takes a share of the width", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(VIEWPORT);
    await openSeededGame(page, baseURL!, 4);
    await page.waitForTimeout(2_000);

    const cards = await handCards(page);
    expect(cards.length, "the seeded hand is thirteen cards").toBe(13);

    // ── Cropped by the bottom edge, and only at the foot.
    const past = cards.filter((c) => c.bottom > VIEWPORT.height);
    expect(
      past.length,
      "no hand card runs past the bottom edge, so nothing was cropped at all"
    ).toBe(cards.length);
    for (const card of cards) {
      const height = card.bottom - card.top;
      const hidden = card.bottom - VIEWPORT.height;
      expect(
        hidden / height,
        `a card is ${Math.round((hidden / height) * 100)}% off-screen — the rank corner ` +
          `at its top-left has to survive the crop`
      ).toBeLessThan(0.4);
      expect(card.top, "a hand card starts below the top of the screen").toBeGreaterThan(0);
    }

    // ── The buttons are not cropped: they sit on the safe line.
    for (const id of ["btn-passa", "btn-gioca"]) {
      const box = await page.locator(`[data-testid="${id}"]`).boundingBox();
      if (!box) throw new Error(`${id} never rendered`);
      expect(
        box.y + box.height,
        `${id} (${Math.round(box.y)}…${Math.round(box.y + box.height)}) is clipped by the ` +
          `bottom edge (${VIEWPORT.height})`
      ).toBeLessThanOrEqual(VIEWPORT.height + 0.5);
    }

    // ── A share of the table, never all of it. The overlap floor can hold a
    //    full hand wider than the share it aims at — a card that cannot be
    //    tapped is worse than a hand that reaches further — but it may never
    //    spread across the felt.
    const span = cards[cards.length - 1].right - cards[0].left;
    expect(
      span / VIEWPORT.width,
      `a thirteen-card hand spans ${Math.round(span)}px of a ${VIEWPORT.width}px screen`
    ).toBeLessThan(0.7);

    // ── …and it never reaches further for having fewer cards in it. Up to the
    //    point where the whole hand fits at the widest step it is allowed, a
    //    card played leaves the span where it was and the overlap loosens
    //    instead — which is the prototype's own behaviour, and why this is a
    //    ceiling rather than a strict shrink.
    await playOneCombination(page);
    const shorter = await handCards(page);
    expect(shorter.length, "no card was played, so nothing shrank").toBeLessThan(cards.length);
    const shorterSpan = shorter[shorter.length - 1].right - shorter[0].left;
    // Measured off bounding boxes, and a shorter fan tilts its end cards a
    // little further, which widens those boxes by about a pixel while the
    // layout span itself is unchanged. The tolerance is that tilt, not slack.
    expect(
      shorterSpan,
      `a shorter hand stretched out to ${Math.round(shorterSpan)}px from ${Math.round(span)}px`
    ).toBeLessThan(span * 1.01);
  });

  // The other end of the same rule: below the point where the widest allowed
  // step still fits, the hand really is narrower — a hand of four is not four
  // cards spread across the share a hand of thirteen fills.
  test("a short hand takes only the room it needs", async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(VIEWPORT);
    await openSeededGame(page, baseURL!, 4, 4);
    await page.waitForTimeout(2_000);

    const cards = await handCards(page);
    expect(cards.length, "the seeded hand is four cards").toBe(4);
    const span = cards[cards.length - 1].right - cards[0].left;
    expect(
      span / VIEWPORT.width,
      `a four-card hand spans ${Math.round(span)}px of a ${VIEWPORT.width}px screen`
    ).toBeLessThan(0.35);
  });
});

/**
 * Plays the first legal selection. GIOCA is the only judge of what is legal,
 * exactly as in tests/e2e/helpers/bot.ts.
 */
async function playOneCombination(page: Page): Promise<void> {
  const gioca = page.locator('[data-testid="btn-gioca"]');
  const labels = await page
    .locator('[aria-label^="La tua mano"] [role="button"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""));
  for (const label of labels) {
    const card = page.locator(`[aria-label^="La tua mano"] [aria-label="${label}"]`);
    await card.click({ timeout: 4_000 }).catch(() => {});
    if ((await gioca.getAttribute("aria-label")) === "Gioca le carte selezionate") {
      await gioca.click({ timeout: 4_000 }).catch(() => {});
      await page.waitForTimeout(1_500);
      return;
    }
    await card.click({ timeout: 4_000 }).catch(() => {});
  }
  throw new Error("no legal opening play was found in the seeded hand");
}
