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

const RECONNECTING = "Connessione persa — riconnessione…";

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
    await expect(page.getByText(RECONNECTING)).toBeVisible({ timeout: 45_000 });
    await expect(table).toBeVisible();

    await context.setOffline(false);
    networkDown = false;

    // Back inside the server's grace window, so the seat was never vacated:
    // the notice clears itself and the same table is still there.
    await expect(page.getByText(RECONNECTING)).toBeHidden({ timeout: 60_000 });
    await expect(table).toBeVisible();

    expect(errors, "no console errors/warnings outside the offline window").toEqual([]);
  } finally {
    await context.close();
  }
});
