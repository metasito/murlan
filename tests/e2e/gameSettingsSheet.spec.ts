// tests/e2e/gameSettingsSheet.spec.ts — the rail's settings sheet: opening it
// without trapping the knob that opened it, focus mode's declutter, the
// left-handed swap, and the row list's own scroll floor. None of this is
// visible to a unit test: it is flexbox layout (the swap), a real fade
// transition (focus mode) and a scrollable box measured against its own
// content (the row list) — exactly the class of thing only a rendered page
// answers (docs/agents/loops.md).
import { test, expect, type Page } from "@playwright/test";
import { openSeededGame } from "./helpers/offlineSeed";

const VIEWPORT = { width: 844, height: 390 };
const RAIL = '[data-testid="control-rail"]';
const VEIL = '[data-testid="settings-veil"]';
const SHEET = '[data-testid="settings-sheet"]';

test.describe("the rail's settings sheet", () => {
  test("opens beside the rail without trapping the knob that opened it", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(VIEWPORT);
    await openSeededGame(page, baseURL!, 4);

    const knob = page.getByRole("button", { name: "Impostazioni" });
    await expect(page.locator(SHEET)).toHaveCount(0);

    await knob.click();
    await expect(page.locator(SHEET)).toBeVisible();
    await expect(knob).toHaveAttribute("aria-expanded", "true");

    // The veil is what closes the sheet on an outside tap, and it must start
    // no further left than the rail's own outer edge — short of that, it
    // covers the knob it exists beside, and closing the sheet takes two taps
    // instead of one.
    const railBox = (await page.locator(RAIL).boundingBox())!;
    const veilBox = (await page.locator(VEIL).boundingBox())!;
    expect(veilBox.x, "the veil reaches under the rail and covers the knob").toBeGreaterThanOrEqual(
      railBox.x + railBox.width - 1
    );

    // The knob itself — not the veil — is what a player taps to close it
    // again, and it has to still be there to tap.
    await knob.click();
    await expect(page.locator(SHEET)).toHaveCount(0);
    await expect(knob).toHaveAttribute("aria-expanded", "false");

    // Reopen and close through the veil instead, proving that path too.
    await knob.click();
    await expect(page.locator(SHEET)).toBeVisible();
    await page.locator(VEIL).click({ position: { x: 5, y: 5 } });
    await expect(page.locator(SHEET)).toHaveCount(0);
  });

  test("focus mode clears the chips, the names and the counts — the cards and the ring stay", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(VIEWPORT);
    await openSeededGame(page, baseURL!, 4);

    const opacityOf = (loc: ReturnType<typeof page.locator>) =>
      loc.evaluate((el) => Number(getComputedStyle(el).opacity));

    const comboChip = page.locator('[data-testid="game-top-bar"]');
    const turnChip = page.locator('[data-testid="game-hud-stack"]');
    const names = page.locator('[data-testid="seat-name"]');
    const counts = page.locator('[data-testid="seat-card-count"]');
    const rings = page.locator('[data-testid="seat-ring"]');
    const backs = page.locator('[data-testid="seat-back"]');

    const namesBefore = await names.count();
    const countsBefore = await counts.count();
    const ringsBefore = await rings.count();
    const backsBefore = await backs.count();
    expect(namesBefore, "no opponent seat rendered a name to begin with").toBeGreaterThan(0);
    expect(countsBefore).toBeGreaterThan(0);
    expect(backsBefore, "no opponent seat rendered any cards to begin with").toBeGreaterThan(0);

    await page.getByRole("button", { name: "Impostazioni" }).click();
    await page.getByRole("switch", { name: "Modalità focus" }).click();

    // The two HUD chips fade rather than unmount — the turn countdown living
    // inside one of them must not be torn down by a toggle that is only
    // about decluttering the felt.
    await expect
      .poll(() => opacityOf(comboChip), { message: "the combo chip never faded out" })
      .toBeLessThan(0.05);
    await expect.poll(() => opacityOf(turnChip)).toBeLessThan(0.05);

    expect(await names.count(), "a seat name is still rendered under focus mode").toBe(0);
    expect(await counts.count(), "a seat's card count is still rendered under focus mode").toBe(0);
    expect(await rings.count(), "the seat ring itself must survive focus mode").toBe(ringsBefore);
    expect(await backs.count(), "the cards themselves must survive focus mode").toBe(backsBefore);

    // Turning it back off restores everything it hid.
    await page.getByRole("switch", { name: "Modalità focus" }).click();
    await expect.poll(() => opacityOf(comboChip)).toBeGreaterThan(0.95);
    expect(await names.count()).toBe(namesBefore);
    expect(await counts.count()).toBe(countsBefore);
  });

  test("play on the left mirrors PASSA and GIOCA without moving the rail", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(VIEWPORT);
    await openSeededGame(page, baseURL!, 4);

    const passa = page.locator('[data-testid="btn-passa"]');
    const gioca = page.locator('[data-testid="btn-gioca"]');
    const railXBefore = (await page.locator(RAIL).boundingBox())!.x;
    const passaXBefore = (await passa.boundingBox())!.x;
    const giocaXBefore = (await gioca.boundingBox())!.x;
    expect(passaXBefore, "PASSA does not start left of GIOCA").toBeLessThan(giocaXBefore);

    await page.getByRole("button", { name: "Impostazioni" }).click();
    await page.getByRole("switch", { name: "Gioca a sinistra" }).click();
    await page.getByRole("button", { name: "Impostazioni" }).click();

    await expect
      .poll(async () => (await gioca.boundingBox())!.x, {
        message: "GIOCA never moved left of PASSA",
      })
      .toBeLessThan((await passa.boundingBox())!.x);
    expect((await page.locator(RAIL).boundingBox())!.x, "the rail moved with the swap").toBe(
      railXBefore
    );
  });

  test("the row list fits without a scrollbar when there is room, and scrolls cleanly when there is not", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 900, height: 700 });
    await openSeededGame(page, baseURL!, 4);
    await page.getByRole("button", { name: "Impostazioni" }).click();

    const rows = page.locator('[data-testid="settings-rows"]');
    const overflowOf = async () =>
      rows.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));

    const roomy = await overflowOf();
    expect(roomy.scroll, "the list overflows its own box even with plenty of height").toBeLessThanOrEqual(
      roomy.client + 1
    );

    // Exit shrinks the window under it — the row list is the only flexible
    // part of the sheet, so it is the one that gives.
    await page.setViewportSize({ width: 900, height: 200 });
    const cramped = await overflowOf();
    expect(
      cramped.scroll,
      "the list did not overflow at all at a height this small"
    ).toBeGreaterThan(cramped.client + 1);

    // Scrolled to, the last row and the exit button are still reachable —
    // a fixed height that clipped mid-row would leave them unreachable
    // instead.
    await page.getByRole("switch", { name: "Gioca a sinistra" }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("switch", { name: "Gioca a sinistra" })).toBeVisible();
    await page.getByRole("button", { name: "Esci dalla partita" }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: "Esci dalla partita" })).toBeVisible();
  });

  test("leaving from the sheet opens the same exit confirmation as the rail knob used to", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(VIEWPORT);
    await openSeededGame(page, baseURL!, 4);

    await page.getByRole("button", { name: "Impostazioni" }).click();
    await page.getByRole("button", { name: "Esci dalla partita" }).click();

    const dialog = page.locator('[aria-modal="true"]');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("confirm-accept")).toBeVisible();
    await page.getByTestId("confirm-cancel").click();
    await expect(dialog).toHaveCount(0);
    // Cancelling the exit leaves the sheet closed behind it, not reopened.
    await expect(page.locator(SHEET)).toHaveCount(0);
  });
});

/**
 * Where focus lands after `presses` tabs, as `<in|OUT>|<label>`. The sheet is
 * not a Modal, so what counts as "inside" is the sheet plus the rail the knob
 * that opened it stands on — the veil covers everything else.
 */
async function tabTour(page: Page, presses: number): Promise<string[]> {
  const seen: string[] = [];
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press("Tab");
    seen.push(
      await page.evaluate((within) => {
        const el = document.activeElement;
        if (!el || el === document.body) return "OUT|body";
        const name =
          el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 24) ?? el.tagName;
        return `${el.closest(within) ? "in" : "OUT"}|${name}`;
      }, `${SHEET},${RAIL}`)
    );
  }
  return seen;
}

test("the open sheet keeps Tab off the table behind its veil", async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  await page.setViewportSize(VIEWPORT);
  await openSeededGame(page, baseURL!, 4);

  const knob = page.getByRole("button", { name: "Impostazioni" });
  await knob.click();
  await expect(page.locator(SHEET)).toBeVisible();

  // The table behind is still in the document — a veil covers pixels and
  // nothing else — so the trap is the only thing keeping it out of reach.
  const behind = page.locator('[data-testid="btn-passa"], [data-testid="btn-gioca"]');
  expect(await behind.count(), "the table underneath is still rendered").toBeGreaterThan(0);

  // More presses than the sheet and the rail have controls between them, so
  // the tour wraps: an untrapped order escapes into the hand well before the
  // last one.
  const TOUR = 24;
  const tour = await tabTour(page, TOUR);
  expect(tour.filter((stop) => stop.startsWith("OUT"))).toEqual([]);

  // The knob is the sheet's own close control and sits outside its box, so it
  // has to be one of the stops — by keyboard, not only by tap.
  expect(tour, "the knob is not in the tab order").toContain("in|Impostazioni");
  const focused = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  for (let i = 0; (await focused()) !== "Impostazioni"; i++) {
    expect(i, "the knob never took focus").toBeLessThan(TOUR);
    await page.keyboard.press("Tab");
  }
  await page.keyboard.press("Enter");
  await expect(page.locator(SHEET)).toHaveCount(0);
});
