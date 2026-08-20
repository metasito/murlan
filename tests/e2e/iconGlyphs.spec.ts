// Every icon glyph actually drawn on screen is a glyph the loaded font
// actually has — checked in the browser, against the real rendered DOM, not
// against the app's source. Static analysis (scripts/iconSubsetChars.mjs,
// tests/iconSubset.test.ts) can only say which names the source asks for; it
// cannot say whether assets/fonts/*.subset.ttf still carries one, and it
// cannot see a name that never appears in the DOM until some interaction
// happens. This is what closes both gaps.
//
// Each screen is driven into every state its icons depend on, not just
// loaded and left alone: `pause` shipped missing from the subset and every
// static check passed, because nothing ever pressed play. A screen visited
// once, at rest, proves nothing about an icon that only exists after a tap.
import { test, expect } from "./fixtures";
import { openApp, registerNewAccount } from "./helpers/navigation";
import { createRoom, fillWithBotsAndStart, goToOnlineLobby } from "./helpers/online";
import { driveGameToCompletion } from "./helpers/bot";
import { assertAllGlyphsRender } from "./helpers/glyphCoverage";

function uniqueUsername(prefix: string): string {
  return `${prefix}${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 900 + 100)}`;
}

test("menu screens render every icon glyph, across the states reachable with no account", async ({
  page,
  baseURL,
  consoleErrors,
}) => {
  test.setTimeout(60_000);

  await openApp(page, baseURL!);
  await assertAllGlyphsRender(page, "home", 26);

  await page.getByRole("button", { name: "Offline" }).click();
  // Four players is what reveals the game-mode row (app/lobby.tsx) — both its
  // options render at once, so both the "person" and "people" mode icons and
  // both the human/bot row icons are already on screen with no further click.
  await page.getByRole("radio", { name: "4 giocatori" }).click();
  await assertAllGlyphsRender(page, "offline lobby — 4 players", 37);
  await page.goBack();

  await page.goto(`${baseURL}/rules`);
  await page.waitForLoadState("networkidle");
  await assertAllGlyphsRender(page, "rules — FAQ collapsed (chevron-down)", 29);
  await page.getByRole("button", { name: "Qual è l'obiettivo del gioco?" }).click();
  await page.waitForTimeout(400); // the answer's height animates open
  await assertAllGlyphsRender(page, "rules — FAQ expanded (chevron-up)", 29);

  await page.goto(`${baseURL}/auth`);
  await page.waitForLoadState("networkidle");
  await assertAllGlyphsRender(page, "auth — password hidden (eye-outline)", 6);
  await page.getByRole("button", { name: "Mostra password" }).click();
  await assertAllGlyphsRender(page, "auth — password shown (eye-off-outline)", 6);

  expect(consoleErrors.entries, "no console errors/warnings across the menu screens").toEqual([]);
});

test("online screens render every icon glyph, across the states reachable once signed in", async ({
  page,
  baseURL,
  consoleErrors,
}) => {
  test.setTimeout(2 * 60_000);

  await openApp(page, baseURL!);
  await registerNewAccount(page, uniqueUsername("glyphs"));

  await goToOnlineLobby(page);
  // Both "Libera" and "Coppie" render together — both branches of
  // `m === "teams" ? "people" : "person"` are already on screen.
  await assertAllGlyphsRender(page, "online lobby — room creator", 49);
  await page.goBack();

  await page.getByRole("button", { name: "Online" }).click();
  await page.waitForLoadState("networkidle");
  // All four MODES render at once (mode.icon), but the "selected mode" chip
  // (selectedMode.icon) only exists after a card is tapped.
  await assertAllGlyphsRender(page, "quickmatch — mode list, nothing selected", 49);
  await page.getByText("1 vs 1", { exact: true }).click();
  await page.waitForTimeout(300);
  await assertAllGlyphsRender(page, "quickmatch — mode selected", 50);
  // Selecting a mode starts matchmaking immediately (quickmatch.tsx
  // handleSelectMode) rather than just toggling a display state, so a full
  // reload is the reliable way back to a known screen — an in-app "cancel"
  // leaves the outcome dependent on whether a match was already found.
  await page.goto(baseURL!);
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "Il mio profilo" }).click();
  await page.waitForTimeout(1500);
  await assertAllGlyphsRender(page, "profile — empty state", 31);

  expect(consoleErrors.entries, "no console errors/warnings across the online screens").toEqual([]);
});

test("the replay screen renders the correct transport icon in both its paused and playing states", async ({
  page,
  baseURL,
  consoleErrors,
}) => {
  test.setTimeout(8 * 60_000);

  await openApp(page, baseURL!);
  await registerNewAccount(page, uniqueUsername("replayglyph"));
  await goToOnlineLobby(page);
  await createRoom(page, { playerCount: 2, gameMode: "free_for_all" });

  // "Manche secca" (single hand) so the first hand ending is the match
  // ending — gameOver.ts writes a replay after any hand with a human seat,
  // and this is the cheapest way to reach one. Not load-bearing for
  // correctness (a multi-hand "Partita" would also eventually reach
  // "Esci dalla partita" and still produce a replay) — only for speed — so a
  // generous budget below covers either outcome rather than trusting this
  // click took effect.
  await page.getByRole("radio", { name: /Manche secca/ }).first().click();
  await fillWithBotsAndStart(page);

  await driveGameToCompletion(page, {
    isFinished: (p) => p.getByRole("button", { name: "Esci dalla partita" }).isVisible(),
    timeoutMs: 5 * 60_000,
  });
  await expect(page.getByRole("button", { name: "Esci dalla partita" })).toBeVisible({ timeout: 15_000 });

  // A hard navigation, not the in-app "leave" button then a click through the
  // home screen: gameOver.ts already wrote the replay the moment the hand
  // ended, so nothing about reaching it depends on the leave flow, and a
  // fresh load bypasses whatever client-side navigation state that flow
  // leaves behind.
  await page.goto(`${baseURL}/profile`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /^Rivedi:/ }).first().click({ timeout: 15_000 });
  await page.waitForURL(/replay/, { timeout: 15_000 });
  await page.waitForTimeout(500);

  await expect(page.getByRole("button", { name: "Riproduci" })).toBeVisible();
  await assertAllGlyphsRender(page, "replay — paused (play)", 28);

  await page.getByRole("button", { name: "Riproduci" }).click();
  await expect(page.getByRole("button", { name: "Pausa" })).toBeVisible();
  await assertAllGlyphsRender(page, "replay — playing (pause)", 28);

  expect(consoleErrors.entries, "no console errors/warnings across the replay screen").toEqual([]);
});
