// tests/e2e/handTapStrips.spec.ts — the fan's tap strips tile the row (#720).
//
// Only a card's own strip receives its presses, and the strips are laid out
// end to end: `hitWidth` gives every card but the last the row's step, so
// card `i`'s strip runs from where it starts to where card `i + 1` starts.
// `cardAtX` (`tests/handLayout.test.ts`) does the same arithmetic on the other
// side of the DOM. What only the browser can say is whether the element the
// finger actually lands on carries the width that arithmetic computed.
//
// Read as a *layout* box. The fan rotates each card, so `boundingBox()` reports
// the rotated envelope, which varies along the row with the tilt — 28.8 to 38.9
// across one hand of equal 30px slots — and a press aimed at an element is
// delivered to that element whatever its box says. Neither a press nor a
// rendered box can see this.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openSeededGame } from "./helpers/offlineSeed";
import { GIOCA_VALID_LABEL } from "./helpers/labels";
import { tap } from "./helpers/press";
import { HAND_CARDS, TABLE } from "./helpers/selectors";

const VIEWPORT = { width: 844, height: 390 };

/**
 * Enough cards that the row's step is solved rather than clamped.
 *
 * `computeHandLayout` bounds the step at both ends, and at this viewport a hand
 * of 13 sits on `MAX_STEP_RATIO` while one of 20 sits on `MIN_READABLE_STEP` —
 * at either stop, playing a card moves nothing, and a strip left at the
 * previous hand's width is indistinguishable from a correct one. Only the
 * compressed middle can fail.
 */
const HAND_SIZE = 16;

interface Strip {
  label: string;
  left: number;
  width: number;
}

/**
 * Every hand card's strip, left to right, from the layout the browser resolved.
 *
 * Summed up the offset chain to the row, because each card sits in its own
 * absolutely positioned wrapper: the slot is the wrapper's `left` and the strip
 * is the pressable's width, so read alone every card reports `offsetLeft` 0.
 * The fan's tilt and spread are transforms on top of that, which is exactly the
 * part a press does not see.
 */
async function strips(page: Page): Promise<Strip[]> {
  const measured = await page.locator(HAND_CARDS).evaluateAll((els) =>
    els.map((el) => {
      let left = 0;
      let node = el as HTMLElement | null;
      while (node && node.dataset.testid !== "hand-row") {
        left += node.offsetLeft;
        node = node.offsetParent as HTMLElement | null;
      }
      return { label: el.getAttribute("aria-label") ?? "", left, width: (el as HTMLElement).offsetWidth };
    })
  );
  return measured.sort((a, b) => a.left - b.left);
}

function gaps(row: Strip[]): string[] {
  const wrong: string[] = [];
  for (let i = 0; i < row.length - 1; i++) {
    const end = row[i].left + row[i].width;
    // Sub-pixel: the step is fractional and the browser rounds the offsets.
    if (Math.abs(end - row[i + 1].left) > 1) {
      wrong.push(
        `${row[i].label} ends at ${end.toFixed(1)} but ${row[i + 1].label} starts at ` +
          `${row[i + 1].left.toFixed(1)}`
      );
    }
  }
  return wrong;
}

test.describe("the hand's tap strips", () => {
  test("tile the row, and still tile it after a card leaves the hand", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(VIEWPORT);
    // The bot is held so the hand this measures is the one the play left
    // behind, rather than whatever the reply dealt into it.
    await openSeededGame(page, baseURL!, 2, HAND_SIZE, 0, true);
    await page.locator(TABLE).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1_500);

    const dealt = await strips(page);
    expect(dealt.length, "the seeded hand rendered no cards").toBeGreaterThan(4);
    expect(gaps(dealt), "the strips leave gaps or overlap in a freshly dealt hand").toEqual([]);
    // The last card's strip is the card itself, so a row of equal strips would
    // mean `hitWidth` is not being applied at all and the case below proves
    // nothing about it.
    expect(
      dealt[dealt.length - 1].width,
      "every strip is the same width, so the row is not the compressed fan this measures"
    ).toBeGreaterThan(dealt[0].width);

    const played = dealt[0].label;
    await tap(page, page.locator(HAND_CARDS).and(page.getByLabel(played)));
    await page.getByRole("button", { name: GIOCA_VALID_LABEL }).click();
    await expect(
      page.locator(HAND_CARDS),
      `playing ${played} did not leave the hand`
    ).toHaveCount(dealt.length - 1);
    await page.waitForTimeout(600);

    const after = await strips(page);
    expect(
      gaps(after),
      "after a play the strips no longer tile — a card is keeping the width the row had " +
        "before it, so presses near its right edge go to its neighbour"
    ).toEqual([]);
    expect(
      after[0].width,
      "the row's step did not move when a card left, so the strips above would tile whether " +
        "or not they were rebuilt, and the case proves nothing"
    ).not.toBe(dealt[0].width);
  });
});
