// tests/e2e/offlineResume.spec.ts — an offline match survives the app going away.
//
// The unit tests cover the stored shape and the native tests cover the
// provider's wiring, but neither can show the thing the feature promises: that
// a player who loses the app gets their hand back. On web a reload is exactly
// that — the process is gone and AsyncStorage (localStorage here) is all that
// carries the game across.
import { test, expect } from "./fixtures";
import { openApp, startOfflineGame } from "./helpers/navigation";

const TABLE = '[data-testid="game-table"]';
const HAND_CARDS = `${TABLE} [aria-label^="La tua mano"] [role="button"]`;

/** The viewer's hand, by the accessible name of each card. */
async function handOf(page: import("@playwright/test").Page): Promise<string[]> {
  return page
    .locator(HAND_CARDS)
    .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""));
}

/** The rail knob opens the settings sheet; leaving is a row inside it. */
async function leaveGame(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "Impostazioni" }).click();
  await page.getByRole("button", { name: "Esci dalla partita" }).click();
}

test("a match interrupted mid-hand is offered back, with the same cards", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await openApp(page, baseURL!);
  await startOfflineGame(page, { playerCount: 4, gameMode: "free_for_all" });
  await page.locator(TABLE).waitFor({ timeout: 60_000 });

  const before = await handOf(page);
  expect(before.length, "the deal put cards in the viewer's hand").toBeGreaterThan(0);

  // The app going away. Nothing is saved on the way out — whatever survives
  // was written while the game was being played.
  await page.reload();
  await page.waitForLoadState("networkidle");

  const resume = page.getByRole("button", { name: "Riprendi partita" });
  await expect(resume, "the home screen offers the interrupted match").toBeVisible({
    timeout: 15_000,
  });

  await resume.click();
  await page.locator(TABLE).waitFor({ timeout: 30_000 });

  // The same hand, not a fresh deal. A new game would almost certainly differ,
  // and comparing the cards themselves is what makes that certain.
  expect(await handOf(page)).toEqual(before);
});

// The counterpart, and the only place the confirmation itself is exercised on
// the platform Replit serves: `Alert.alert` is an empty function under
// react-native-web, so this dialog and its destructive branch existed on
// native only and the quit button did nothing at all on web.
test("quitting asks first, and taking the offer back clears it", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await openApp(page, baseURL!);
  await startOfflineGame(page, { playerCount: 4, gameMode: "free_for_all" });
  await page.locator(TABLE).waitFor({ timeout: 60_000 });

  await leaveGame(page);

  const dialog = page.getByRole("button", { name: "Esci", exact: true });
  await expect(dialog, "the confirmation has to be on screen at all").toBeVisible({
    timeout: 10_000,
  });

  // Declining leaves the game exactly where it was.
  await page.getByRole("button", { name: "Annulla" }).click();
  await expect(page.locator(TABLE)).toBeVisible();

  await leaveGame(page);
  await page.getByRole("button", { name: "Esci", exact: true }).click();

  // resetGame() clears the save, so the home screen no longer offers it —
  // which is what never ran while the confirmation could not be shown.
  await expect(page.getByRole("button", { name: "Riprendi partita" })).toHaveCount(0, {
    timeout: 15_000,
  });
});
