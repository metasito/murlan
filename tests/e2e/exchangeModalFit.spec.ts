// tests/e2e/exchangeModalFit.spec.ts — the exchange modal fits a landscape
// phone.
//
// The table is landscape-locked, so this modal is only ever seen on a window
// ~375-390pt tall. Its stack of two player rows, a picker and a confirm is
// taller than that, and `styles.overlay` centres the overflow — half off the
// top, half off the bottom, taking CONFIRM with it. The hand cannot proceed
// until a card is given, so the player is stuck (#352).
//
// Only a browser can see it: tests/native/exchangeModalConfirm.test.tsx renders
// on react-test-renderer, which never runs flexbox (CLAUDE.md, *Known
// pitfalls*), and exchangePickChange.spec.ts sets no viewport so it runs at the
// 720pt-tall desktop default, where the stack fits.
import { test, expect } from "./fixtures";
import { resumeSaved, offlineGameSave, DEAL_SIZE } from "./helpers/offlineSeed";
import { TOUCH_TARGET_MIN } from "../../lib/theme";

// tests/e2e/tableFit.spec.ts's own phone fixtures, which are the windows this
// modal is actually seen in.
const VIEWPORTS = [
  { name: "small phone landscape", width: 667, height: 375 },
  { name: "large phone landscape", width: 844, height: 390 },
];

/**
 * A two-seat hand mid-exchange with the viewer as the winner, dealt in full:
 * the picker holds every card the winner may give back, which is the widest
 * the modal ever gets.
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
  test(`the whole exchange modal is on screen — ${vp.name}`, async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await resumeSaved(page, baseURL!, midExchangeSave());

    const dialog = page.getByRole("dialog", { name: "Scambio di carte" });
    await expect(dialog, "the exchange modal has to open").toBeVisible({ timeout: 15_000 });

    const confirm = page.getByTestId("exchange-confirm");
    const box = await confirm.boundingBox();
    if (!box) throw new Error("the confirm button never rendered");

    // The floor: a button that laid out as an empty box would sit inside any
    // viewport bound below having drawn nothing.
    expect(box.height, "CONFIRM has no height at all").toBeGreaterThanOrEqual(TOUCH_TARGET_MIN);

    expect(
      Math.round(box.y + box.height),
      `CONFIRM ends at ${Math.round(box.y + box.height)} on a ${vp.height}px-tall screen — ` +
        `it is off the bottom edge, and the hand cannot proceed without it`
    ).toBeLessThanOrEqual(vp.height);
    expect(Math.round(box.y), "CONFIRM starts above the top edge").toBeGreaterThanOrEqual(0);

    // Off-screen is not the only way to lose it: something drawn over it takes
    // the tap just as completely.
    const hit = await confirm.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return top ? el.contains(top) || top.contains(el) : false;
    });
    expect(hit, "the point at CONFIRM's centre does not resolve to CONFIRM").toBe(true);

    // The rest of the modal, which the same overflow splits off the top: the
    // title, both player rows and the picker.
    const modalBox = await dialog.evaluate((el) => {
      // The dialog is the full-screen overlay; the panel is the box it centres.
      const panel = el.firstElementChild ?? el;
      const r = panel.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
    });
    expect(modalBox.height, "the modal panel has no height at all").toBeGreaterThan(100);
    expect(
      Math.round(modalBox.top),
      `the modal runs from ${Math.round(modalBox.top)} to ${Math.round(modalBox.bottom)} on a ` +
        `${vp.height}px-tall screen`
    ).toBeGreaterThanOrEqual(0);
    expect(Math.round(modalBox.bottom)).toBeLessThanOrEqual(vp.height);
    expect(Math.round(modalBox.left)).toBeGreaterThanOrEqual(0);
    expect(Math.round(modalBox.right)).toBeLessThanOrEqual(vp.width);
  });
}
