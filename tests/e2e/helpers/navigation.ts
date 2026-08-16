// Navigation through the menu chrome that every scenario has to cross before
// a game exists: the first-launch tutorial prompt, the home screen, the
// offline lobby, and (for online scenarios) registration.

import type { Page } from "@playwright/test";

async function dismissTutorialPromptIfShown(page: Page): Promise<void> {
  const skip = page.getByRole("button", { name: "Salta" });
  if (await skip.count()) await skip.click();
}

/** Loads the app fresh and clears the one-time tutorial prompt. */
export async function openApp(page: Page, baseURL: string): Promise<void> {
  await page.goto(baseURL);
  await page.waitForLoadState("networkidle");
  await dismissTutorialPromptIfShown(page);
}

export type LobbyMode = "ai" | "local";

export interface OfflineSetup {
  playerCount: 2 | 3 | 4;
  gameMode: "free_for_all" | "teams";
  /**
   * "match" (first to the target score, several hands with an exchange
   * between each — the lobby's default) or "single" (one hand, quick). Only
   * "single" needs a click; "match" is the pre-selected default.
   */
  format?: "match" | "single";
}

/** From the home screen: opens the offline lobby, configures it, and starts the game. */
export async function startOfflineGame(page: Page, setup: OfflineSetup): Promise<void> {
  await page.getByRole("button", { name: "Offline" }).click();
  await page.getByRole("radio", { name: `${setup.playerCount} giocatori` }).click();

  if (setup.playerCount === 4) {
    const modeLabel = setup.gameMode === "teams" ? "A Coppie" : "Tutti vs Tutti";
    await page.getByRole("radio", { name: modeLabel, exact: true }).click();
  }

  if (setup.format === "single") {
    await page.getByRole("radio", { name: "Manche secca" }).click();
  }

  await page.getByRole("button", { name: "Inizia Partita" }).click();
}

/** Registers a brand-new account through the UI and lands back on the home screen. */
export async function registerNewAccount(page: Page, username: string): Promise<void> {
  await page.getByRole("button", { name: "Gioca con amici" }).click();
  await page.waitForURL(/\/auth/);
  await page.getByRole("tab", { name: "Registrati" }).click();
  await page.getByRole("textbox", { name: "Nome utente" }).fill(username);
  await page.getByRole("textbox", { name: "Password" }).fill("e2e-test-pw");
  await page.getByRole("button", { name: "Crea account" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"));
}
