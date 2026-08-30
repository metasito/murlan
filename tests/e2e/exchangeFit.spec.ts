// tests/e2e/exchangeFit.spec.ts — the whole exchange fits a landscape phone.
//
// #352: the exchange dialog's stack of two player rows, a picker and a confirm
// was taller than a ~375-390pt window, and the overlay centred the overflow —
// half off the top, half off the bottom, taking the confirm with it. The hand
// cannot proceed until a card is given, so the player was stuck.
//
// The dialog is gone (#533) and the exchange is the table itself, which makes
// the same defect cheaper to hit and no less fatal: the prompt sits in the
// centre band, the giveable cards in the fan, and the confirm is the table's
// own GIOCA. Any of the three off the edge, or covered, and the player is stuck
// exactly as before.
//
// Only a browser can see it: react-test-renderer never runs flexbox
// (CLAUDE.md, *Known pitfalls*), and the other exchange specs set no viewport,
// so they run at the 720pt-tall desktop default where everything fits.
import { test, expect } from "./fixtures";
import { resumeSaved, offlineGameSave, DEAL_SIZE } from "./helpers/offlineSeed";
import { TOUCH_TARGET_MIN } from "../../lib/tokens";
import { TABLE } from "./helpers/selectors.ts";

// tests/e2e/tableFit.spec.ts's own phone fixtures, which are the windows this
// is actually seen in.
const VIEWPORTS = [
  { name: "small phone landscape", width: 667, height: 375 },
  { name: "large phone landscape", width: 844, height: 390 },
];

/**
 * A two-seat hand mid-exchange with the viewer as the winner, dealt in full:
 * the fan holds every card the winner was given, which is the most the table
 * ever has to fit at once during an exchange.
 */
function midExchangeSave(): object {
  const save: any = offlineGameSave(2, DEAL_SIZE[2], 0);
  // The loser's own card, taken out of their hand so it is not in two places —
  // and not out of the winner's, which would leave it a legal giveback.
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

for (const vp of VIEWPORTS) {
  test(`the whole exchange is on screen and hittable — ${vp.name}`, async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await resumeSaved(page, baseURL!, midExchangeSave());

    const prompt = page.getByTestId("exchange-prompt");
    await expect(prompt, "the exchange has to ask on the felt").toBeVisible({ timeout: 15_000 });

    // Soft, so one run reports every way it does not fit rather than stopping
    // at the first — the prompt and the confirm go off different edges.
    const promptBox = await prompt.boundingBox();
    if (!promptBox) throw new Error("the prompt never rendered");

    // The floor: a prompt with no height would satisfy every bound below.
    expect.soft(promptBox.height, "the prompt has no height at all").toBeGreaterThan(20);
    expect.soft(
      Math.round(promptBox.y),
      `the prompt runs from ${Math.round(promptBox.y)} to ` +
        `${Math.round(promptBox.y + promptBox.height)} on a ${vp.height}px-tall screen`
    ).toBeGreaterThanOrEqual(0);
    expect.soft(Math.round(promptBox.y + promptBox.height)).toBeLessThanOrEqual(vp.height);
    expect.soft(Math.round(promptBox.x)).toBeGreaterThanOrEqual(0);
    expect.soft(Math.round(promptBox.x + promptBox.width)).toBeLessThanOrEqual(vp.width);

    // The prompt lives in the centre band, which is the space left below the
    // top seat's whole column — so it must not reach that seat's own plate.
    // That overlap is the condition #532's decision attached to this layout.
    const topSeat = await page.getByTestId("top-seat").boundingBox();
    if (topSeat) {
      expect.soft(
        Math.round(promptBox.y),
        `the prompt starts at ${Math.round(promptBox.y)}, inside the top seat which ends at ` +
          `${Math.round(topSeat.y + topSeat.height)} — the card would sit on that player's name`
      ).toBeGreaterThanOrEqual(Math.round(topSeat.y + topSeat.height));
    }

    // At least one card in the fan is giveable, and it is reachable.
    const giveable = page.locator(`${TABLE} button[aria-label]:not([aria-disabled="true"])`);
    expect.soft(await giveable.count(), "no card in the fan can be given").toBeGreaterThan(0);

    const confirm = page.getByTestId("btn-gioca");
    const box = await confirm.boundingBox();
    if (!box) throw new Error("the confirm button never rendered");

    expect.soft(
      Math.round(box.height),
      `the confirm is ${Math.round(box.height)}pt tall, under the ${TOUCH_TARGET_MIN}pt floor`
    ).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN);
    expect.soft(
      Math.round(box.y + box.height),
      `the confirm ends at ${Math.round(box.y + box.height)} on a ${vp.height}px-tall screen — ` +
        `it is off the bottom edge, and the hand cannot proceed without it`
    ).toBeLessThanOrEqual(vp.height);
    expect.soft(Math.round(box.y), "the confirm starts above the top edge").toBeGreaterThanOrEqual(0);

    // Off-screen is not the only way to lose it: something drawn over it takes
    // the tap just as completely.
    const hit = await confirm.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return top ? el.contains(top) || top.contains(el) : false;
    });
    expect.soft(hit, "the point at the confirm's centre does not resolve to it").toBe(true);
  });
}
