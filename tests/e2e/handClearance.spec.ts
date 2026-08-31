// tests/e2e/handClearance.spec.ts — nothing cuts a card off in the hand.
//
// A hand too wide for its window is moved under a box that clips it, and
// `overflow` takes both axes or neither: a box sized to the row is a box that
// crops the fan. The row is only part of what the row *draws* — a card sits
// `arcRise` above its top at the arc's high point and lifts `handRowHeadroom`
// further when it is chosen — so the two were short of each other, and the
// symptom was a straight horizontal line across the top of the hand with the
// cards' rounded corners cut square.
//
// Only a browser can see it. `react-test-renderer` never runs flexbox, so no
// native test can say where a card ended up, and the arithmetic alone cannot
// say what clips it. Reported from iOS, where the row goes wide sooner; the
// smallest handset here is where the same branch is reached in Chromium.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { resumeSaved, offlineGameSave, DEAL_SIZE } from "./helpers/offlineSeed";
import { PHONES } from "./helpers/phones";
import { TABLE, HAND_CARDS, HAND_ZONE } from "./helpers/selectors";

/**
 * The seat count that deals the widest hand, asked of the engine rather than
 * fixed here: the row only overflows — and so only gets a clipping window — when
 * it cannot fit, so a narrower hand passes by drawing no window at all.
 */
const WIDEST_SEATS = ([2, 3, 4] as const).reduce((a, b) =>
  DEAL_SIZE[b] > DEAL_SIZE[a] ? b : a
);

/** The handset the row cannot fit on, whatever the list holds. */
const NARROWEST = PHONES.reduce((a, b) => (b.width < a.width ? b : a));
/** A press long enough to be a press, and far short of `HOLD_MS`. */
const TAP_MS = 120;
/** Past `HOLD_MS` in components/table/hand.tsx, with room for a slow runner. */
const HOLD_PAST_MS = 800;
const DRAG_ALONG = 60;
const DRAG_UP = 40;

/** Mid-exchange with the viewer choosing: the worst case for the clip. */
function midExchangeSave(): object {
  const save: Record<string, any> = offlineGameSave(WIDEST_SEATS, DEAL_SIZE[WIDEST_SEATS], 0);
  const cardFromLoser = save.gameState.players[1].hand.shift();
  save.gameState.exchangePhase = {
    active: true,
    winnerIdx: 0,
    loserIdx: 1,
    cardFromLoser,
    bothJokersException: false,
  };
  return save;
}

interface Cut {
  label: string;
  top: number;
  bottom: number;
  clipTop: number;
  clipBottom: number;
}

/**
 * The top edge of the card riding the finger, or null while none is. It is the
 * only card drawn above the row's own stacking order, which is what names it.
 */
async function heldCardTop(page: Page): Promise<{ top: number; clipTop: number } | null> {
  return page.evaluate((sel: string) => {
    const zone = document.querySelector(sel);
    if (!zone) return null;
    for (const node of Array.from(zone.querySelectorAll("*"))) {
      if (getComputedStyle(node).zIndex !== "100") continue;
      let clip = node.parentElement;
      while (clip && clip !== document.body) {
        const overflow = getComputedStyle(clip).overflow;
        if (overflow !== "visible" && overflow !== "") break;
        clip = clip.parentElement;
      }
      if (!clip || clip === document.body) return null;
      return {
        top: Math.round(node.getBoundingClientRect().top),
        clipTop: Math.round(clip.getBoundingClientRect().top),
      };
    }
    return null;
  }, `${TABLE} ${HAND_ZONE}`);
}

/** How many hand cards sit under a box that clips — the check's own floor. */
async function clippedCards(page: Page): Promise<number> {
  return page.evaluate((sel: string) => {
    const zone = document.querySelector(sel);
    if (!zone) return 0;
    let under = 0;
    for (const button of Array.from(zone.querySelectorAll('[role="button"]'))) {
      let node = button.parentElement?.parentElement?.parentElement ?? null;
      while (node && node !== document.body) {
        const overflow = getComputedStyle(node).overflow;
        if (overflow !== "visible" && overflow !== "") {
          if (node.getBoundingClientRect().height < window.innerHeight) under++;
          break;
        }
        node = node.parentElement;
      }
    }
    return under;
  }, `${TABLE} ${HAND_ZONE}`);
}

/** Every hand card whose own box falls outside a clipping ancestor. */
async function cutCards(page: Page): Promise<Cut[]> {
  return page.evaluate((sel: string) => {
    const zone = document.querySelector(sel);
    if (!zone) return [];
    const out: Cut[] = [];
    for (const button of Array.from(zone.querySelectorAll('[role="button"]'))) {
      // Pressable → CardView's animated wrapper → the card's own box.
      const wrap = button.parentElement?.parentElement;
      if (!wrap) continue;
      const box = wrap.getBoundingClientRect();
      let node = wrap.parentElement;
      while (node && node !== document.body) {
        const style = getComputedStyle(node);
        if (style.overflow !== "visible" && style.overflow !== "") {
          const clip = node.getBoundingClientRect();
          // A card the *window* cuts is the deliberate crop; only a box inside
          // the page is this spec's business.
          if (clip.height < window.innerHeight && (box.top < clip.top - 0.5 || box.bottom > clip.bottom + 0.5)) {
            out.push({
              label: button.getAttribute("aria-label") ?? "?",
              top: Math.round(box.top),
              bottom: Math.round(box.bottom),
              clipTop: Math.round(clip.top),
              clipBottom: Math.round(clip.bottom),
            });
          }
          break;
        }
        node = node.parentElement;
      }
    }
    return out;
  }, `${TABLE} ${HAND_ZONE}`);
}

for (const phone of PHONES) {
  test(`no card in the hand is cut off — ${phone.name}`, async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: phone.width, height: phone.height });
    await resumeSaved(page, baseURL!, midExchangeSave());
    await page.locator(TABLE).waitFor({ timeout: 30_000 });
    await expect(page.getByTestId("exchange-prompt")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1_200);

    // The floor: on the smallest handset the row cannot fit, so the window this
    // spec is about must exist. Without this the whole file passes by drawing no
    // clip at all, which is how it would greet the next change to the deal.
    if (phone === NARROWEST) {
      expect(await clippedCards(page), "no clipping window on the smallest phone").toBeGreaterThan(
        0
      );
    }

    expect(await cutCards(page), "a card is cut before anything is chosen").toEqual([]);

    // Choosing one lifts it, which is the state the clearance is for. Pressed
    // rather than clicked: a zero-duration click is not a tap, and the hand
    // reads the press's length.
    for (const card of await page.locator(HAND_CARDS).all()) {
      if ((await card.getAttribute("aria-disabled")) === "true") continue;
      const box = await card.boundingBox();
      if (!box) continue;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(TAP_MS);
      await page.mouse.up();
      break;
    }
    await page.waitForTimeout(700);

    const cut = await cutCards(page);
    expect(
      cut,
      `a chosen card is cut off: ${JSON.stringify(cut)}`
    ).toEqual([]);
  });
}

// A card being dragged is drawn inside the same window, and it follows the
// finger in both axes rather than sitting on the arc — so it is the one card
// whose height the clearance cannot derive from the layout.
test(`a card dragged out of the fan is not cut off — ${NARROWEST.name}`, async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: NARROWEST.width, height: NARROWEST.height });
  await resumeSaved(page, baseURL!, offlineGameSave(WIDEST_SEATS, DEAL_SIZE[WIDEST_SEATS], 0));
  await page.locator(TABLE).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1_200);
  expect(await clippedCards(page), "no clipping window to test against").toBeGreaterThan(0);

  const card = page.locator(HAND_CARDS).nth(2);
  const box = await card.boundingBox();
  expect(box, "no card to drag").not.toBeNull();

  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(HOLD_PAST_MS);
  // Up as well as along: a thumb reordering cards does not stay on one line,
  // and up is the direction the window has least room in.
  await page.mouse.move(x + DRAG_ALONG, y - DRAG_UP, { steps: 8 });
  await page.waitForTimeout(200);

  // The floor again: without a card actually off the fan there is nothing here
  // to cut, and the assertion below would pass on a drag that never started.
  // `cutCards` cannot see this one — the card riding the finger is decorative,
  // and carries no role of its own.
  const held = await heldCardTop(page);
  const cut = await cutCards(page);
  await page.mouse.up();

  expect(held, "no card left the fan — the drag never started").not.toBeNull();
  expect(
    held!.top,
    `the dragged card is cut: top ${held!.top} against a clip at ${held!.clipTop}`
  ).toBeGreaterThanOrEqual(held!.clipTop - 0.5);
  expect(cut, `a card in the fan is cut off: ${JSON.stringify(cut)}`).toEqual([]);
});
