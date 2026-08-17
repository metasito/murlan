// Navigation through the online multiplayer chrome: registering an account,
// creating/joining a room, and starting the server-authoritative game.

import type { Page } from "@playwright/test";

/**
 * From an already-authenticated home screen, opens the online room lobby.
 * Expo Router strips a parenthesised route group like `(online)` from the
 * URL entirely, so nothing about the resulting path names it — waiting for
 * the create-room button is the reliable signal that the screen mounted.
 */
export async function goToOnlineLobby(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Gioca con amici" }).click();
  await page.getByRole("button", { name: "Crea Stanza" }).waitFor();
}

export interface RoomSetup {
  playerCount: 2 | 3 | 4;
  gameMode: "free_for_all" | "teams";
}

/** Creates a room and returns its 6-character join code. */
export async function createRoom(page: Page, setup: RoomSetup): Promise<string> {
  if (setup.gameMode === "teams") {
    await page.getByRole("radio", { name: "Coppie" }).click();
  }
  await page.getByRole("radio", { name: `${setup.playerCount} giocatori` }).click();
  await page.getByRole("button", { name: "Crea Stanza" }).click();
  await page.waitForURL(/\/room/);

  // The code itself carries no label or testid of its own; it is the next
  // sibling of the "CODICE STANZA" caption (app/(online)/room.tsx).
  const codeLocator = page.getByText("CODICE STANZA").locator("xpath=following-sibling::*[1]");
  await codeLocator.waitFor();
  return (await codeLocator.textContent())!.trim();
}

export async function joinRoom(page: Page, code: string): Promise<void> {
  await page.getByRole("button", { name: "Inserisci codice stanza" }).click();
  await page.getByRole("textbox", { name: "Codice stanza" }).fill(code);
  await page.getByRole("button", { name: "Entra", exact: true }).click();
  await page.waitForURL(/\/room/);
}

/** Host-only: fills every empty seat with bots and starts immediately. */
export async function fillWithBotsAndStart(page: Page): Promise<void> {
  // react-native-web's Switch renders both a wrapping div and an inner
  // checkbox input under the same role/label.
  await page.getByRole("switch", { name: "Riempi i posti liberi con bot" }).first().click();
  await page.getByRole("button", { name: "Inizia Partita" }).click();
  await page.waitForURL(/\/game/);
}

export async function startRoom(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Inizia Partita" }).click();
  await page.waitForURL(/\/game/);
}
