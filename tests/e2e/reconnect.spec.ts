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
import { mockupAt, stage } from "./helpers/mockupStage";

const RECONNECTING = "Connessione persa — riconnessione…";
const OFFLINE = "Nessuna connessione Internet";
const TURN = '[data-testid="notice-turn"]';
const dotOf = (page: Page, sel: string) => page.evaluate((s) => getComputedStyle(document.querySelector(s)!).backgroundColor, sel);

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

    networkDown = true;
    await context.setOffline(true);

    // The whole point: a disconnect is a speed bump, not a cliff. The
    // player is told, and the table stays on screen rather than being replaced
    // by an error or left silently frozen.
    await expect(page.getByTestId("notice-turn").getByText(RECONNECTING)).toBeVisible({ timeout: 45_000 });
    await expect(table).toBeVisible();
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

    await setDeviceOffline(context, page, true);
    await expect(page.getByTestId("notice-turn").getByText(OFFLINE), "the device offline outranks the reconnect").toBeVisible();
    const app = stage(page, null);
    const got = (await app.plate(TURN))!;
    const gotDot = await dotOf(page, `${TURN} [data-testid="turn-chip-dot"]`);
    const offTable = await app.plate('[data-testid="notice-offline"]');
    const mockup = await mockupAt(browser, "reconnect", 8000);
    const want = (await mockup.plate("#turn.bad"))!;
    const wantDot = await dotOf(mockup.page, "#turn.bad .dot");
    await mockup.close();
    expect.soft(got.edge, "#turn.bad's edge").toBe(want.edge);
    expect.soft(got.ink, "#turn.bad's ink").toBe(want.ink);
    expect.soft(gotDot, "#turn.bad's dot").toBe(wantDot);
    expect.soft(got.glow, "#turn.bad casts no glow").toEqual(want.glow);
    expect(offTable?.opacity, "the pill off the table yields to the table").toBe(0);

    await setDeviceOffline(context, page, false);
    networkDown = false;

    // Back inside the server's grace window, so the seat was never vacated:
    // the notice clears itself and the same table is still there.
    await expect(page.getByTestId("notice-turn").getByText(RECONNECTING)).toBeHidden({ timeout: 60_000 });
    await expect(table).toBeVisible();

    expect(errors, "no console errors/warnings outside the offline window").toEqual([]);
  } finally {
    await context.close();
  }
});
