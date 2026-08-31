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

/** Mid-exchange with the viewer choosing: the widest the hand ever has to be. */
function midExchangeSave(): object {
  const save: Record<string, any> = offlineGameSave(2, DEAL_SIZE[2], 0);
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

    expect(await cutCards(page), "a card is cut before anything is chosen").toEqual([]);

    // Choosing one lifts it, which is the state the clearance is for.
    for (const card of await page.locator(HAND_CARDS).all()) {
      if ((await card.getAttribute("aria-disabled")) === "true") continue;
      const box = await card.boundingBox();
      if (!box) continue;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
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
