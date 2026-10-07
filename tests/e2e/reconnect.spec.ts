// Losing the connection mid-game, and getting it back.
//
// The server half of this — the grace timer, the seat takeover when it expires
// — is covered by tests/integration/gameplay.test.ts ("a vacated seat does not
// deadlock the table"). What only a real browser can show is the half the
// player actually experiences: that the table says so instead of silently
// freezing, and that it clears itself once the socket is back.
//
// This spec runs its own context rather than the shared `page` fixture: going
// offline necessarily produces failed requests, and the fixture fails a test on
// any console error. The errors are still collected — just not the ones raised
// while the network is deliberately down.

import type { Page } from "@playwright/test";
import { test, expect, isExpectedNoise } from "./fixtures";
import { openApp, registerNewAccount, uniqueUsername } from "./helpers/navigation";
import { createRoom, fillWithBotsAndStart, goToOnlineLobby } from "./helpers/online";
import { setDeviceOffline } from "./helpers/deviceNetwork";
import { mockupAt, stage, type Stage } from "./helpers/mockupStage";
import { Reconnect, TOUCH_TARGET_MIN } from "../../lib/tokens";

const RECONNECTING = "Riconnessione…";
const LOST = "Connessione persa";
const RETRY = "Riprova";
const BACK = "Di nuovo in linea";
const OFFLINE = "Nessuna connessione Internet";
const GREY = `grayscale(${Reconnect.grey}) brightness(${1 - Reconnect.darken * Reconnect.grey})`;
const TURN = '[data-testid="notice-turn"]';
const dotOf = (page: Page, sel: string) => page.evaluate((s) => getComputedStyle(document.querySelector(`${s} [data-testid="turn-chip-dot"], ${s} .dot`)!).backgroundColor, sel);

const plateAndDot = async (side: Stage, page: Page, sel: string) => ({ plate: (await side.plate(sel))!, dot: await dotOf(page, sel) });
function expectPlate(got: Awaited<ReturnType<typeof plateAndDot>>, want: typeof got, name: string) {
  expect.soft(got.plate.edge, `${name}'s edge`).toBe(want.plate.edge);
  expect.soft(got.plate.ink, `${name}'s ink`).toBe(want.plate.ink);
  expect.soft(got.dot, `${name}'s dot`).toBe(want.dot);
  expect.soft(got.plate.glow, `${name} casts no glow`).toEqual(want.plate.glow);
}

test("online — a dropped connection says so, and the table comes back", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(4 * 60_000);

  const context = await browser.newContext({ locale: "it-IT" });
  const page: Page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });

  // Everything the browser reports while the network is up. The offline window
  // is excluded on purpose — a failed socket connection is the thing under
  // test, not a defect.
  let networkDown = false;
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (networkDown) return;
    if (msg.type() !== "error" && msg.type() !== "warning") return;
    if (isExpectedNoise(msg.text(), msg.location().url)) return;
    errors.push(`console.${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    if (networkDown) return;
    errors.push(`pageerror: ${err.message}`);
  });

  try {
    await openApp(page, baseURL!);
    await registerNewAccount(page, uniqueUsername("e2erec"));
    await goToOnlineLobby(page);
    await createRoom(page, { playerCount: 2, gameMode: "free_for_all" });
    await fillWithBotsAndStart(page);

    const table = page.locator('[data-testid="game-table"]');
    await expect(table).toBeVisible();

    const greyOf = () => table.evaluate((el) => getComputedStyle(el).filter);
    expect(await greyOf(), "a live table is not grey").toBe("none");

    networkDown = true;
    await context.setOffline(true);

    // The whole point: a disconnect is a speed bump, not a cliff. The
    // player is told, and the table stays on screen rather than being replaced
    // by an error or left silently frozen.
    await expect(page.getByTestId("notice-turn").getByText(RECONNECTING)).toBeVisible({ timeout: 45_000 });
    await expect(table).toBeVisible();
    expect(await greyOf(), "the table holds its breath, with no fade under reduced motion").toBe(GREY);
    const sampleDot = () =>
      page
        .getByTestId("notice-turn")
        .getByTestId("turn-chip-dot")
        .evaluate(async (dot) => {
          const seen: number[] = [];
          for (let i = 0; i < 9; i++) {
            seen.push(Number(getComputedStyle(dot).opacity));
            // fixed wait on purpose: nine samples 125 ms apart span one 900 ms blink
            await new Promise((r) => setTimeout(r, 125));
          }
          return seen;
        });
    const still = await sampleDot();
    expect(Math.min(...still), `the dot holds still under reduced motion: ${still}`).toBe(1);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const blink = await sampleDot();
    expect(Math.min(...blink), `the reconnecting dot blinks: ${blink}`).toBeLessThanOrEqual(0.4);
    expect(Math.max(...blink), `the reconnecting dot blinks: ${blink}`).toBeGreaterThanOrEqual(0.9);

    const retry = page.getByRole("button", { name: `${LOST}, ${RETRY}` });
    await expect(retry, "still down past the give-up, the pill offers Riprova").toBeVisible({ timeout: 30_000 });
    expect(await greyOf(), "the table stays grey once it gives up").toBe(GREY);
    const hit = (await retry.boundingBox())!;
    expect(hit.height, "Riprova meets the 44 pt floor").toBeGreaterThanOrEqual(TOUCH_TARGET_MIN);
    const app = stage(page, null);
    const lost = await plateAndDot(app, page, TURN);
    const mockup = await mockupAt(browser, "reconnect", 8000);
    const wantLost = await plateAndDot(mockup, mockup.page, "#turn.bad");
    expectPlate(lost, wantLost, "#turn.bad");

    await setDeviceOffline(context, page, true);
    await expect(page.getByTestId("notice-turn").getByText(OFFLINE), "the device offline outranks the reconnect").toBeVisible();
    const offTable = await app.plate('[data-testid="notice-offline"]');
    expect(offTable?.opacity, "the pill off the table yields to the table").toBe(0);
    await setDeviceOffline(context, page, false);
    networkDown = false;

    // Back inside the server's grace window, so the seat was never vacated: the
    // table says so, lets go of the grey and is the same table.
    await retry.click();
    await expect(page.getByTestId("notice-turn").getByText(BACK)).toBeVisible({ timeout: 30_000 });
    const back = await plateAndDot(app, page, TURN);
    const backMockup = await mockupAt(browser, "reconnect", 3600);
    expectPlate(back, await plateAndDot(backMockup, backMockup.page, "#turn.ok"), "#turn.ok");
    await backMockup.close();
    await mockup.close();
    await expect(page.getByTestId("notice-turn").getByText(BACK)).toBeHidden({ timeout: 10_000 });
    expect(await greyOf(), "the colour comes back").toBe("none");
    await expect(table).toBeVisible();

    expect(errors, "no console errors/warnings outside the offline window").toEqual([]);
  } finally {
    await context.close();
  }
});
