// Navigation through the menu chrome that every scenario has to cross before
// a game exists: the home screen, the offline lobby, and (for online
// scenarios) registration.

import type { Page } from "@playwright/test";

// `lib/tutorialSeen.ts`'s SEEN_KEY. AsyncStorage on web writes straight to
// localStorage with the key unprefixed, so seeding it here is the same write
// the app itself makes. tests/tutorialSeenKey.test.ts pins the two together.
const TUTORIAL_SEEN_KEY = "@murlan_tutorial_seen";

/**
 * How long the home screen has to become interactive.
 *
 * Bounded on purpose: with no timeout this wait runs to the *test's* budget, so
 * a spec that never gets a home screen spends its whole allowance here and then
 * fails at whatever line came next, describing that instead. Generous against a
 * cold bundle on a shared runner, and short enough that the failure it reports
 * is this one.
 */
const HOME_SCREEN_MS = 45_000;

/**
 * Loads the app on a device that has already been offered the tutorial, and
 * returns once the home screen is interactive.
 *
 * The title screen decides whether to push `/tutorial` asynchronously: auth
 * has to settle, then a storage read resolves, then `router.push` runs. That
 * decision can land *after* the home screen has rendered, so a caller that
 * clicks straight away has the screen navigated out from under it and then
 * waits out its whole timeout on a button that no longer exists — which is why
 * every recorded failure was a home-screen click, and why they burned the full
 * timeout rather than arriving late. Seeding the answer the decision reads
 * removes the race instead of racing it faster.
 */
export async function openApp(page: Page, baseURL: string): Promise<void> {
  await page.addInitScript((key: string) => {
    window.localStorage.setItem(key, "1");
  }, TUTORIAL_SEEN_KEY);
  await page.goto(baseURL);
  // `networkidle` is the bundle arriving, not the app being interactive. The
  // offline row is the one home entry rendered unconditionally — the resume
  // row above it appears only with a saved game.
  await page
    .getByRole("button", { name: "Offline" })
    .waitFor({ state: "visible", timeout: HOME_SCREEN_MS });
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
  await page.locator('[data-testid="game-table"]').waitFor({ timeout: 60_000 });
  await dismissStartAnnouncement(page);
}

/**
 * Clears the manche-opening announcement if one is up (#817).
 *
 * It is a gate: it covers the table so the first tap is spent reading it
 * rather than playing a card, which is exactly what a spec's own first tap
 * would otherwise be spent on. A real player's tap, so a spec does what a
 * player does instead of reaching under it. A no-op when nothing is up — a
 * seeded table has no start reason to announce.
 */
export async function dismissStartAnnouncement(page: Page): Promise<void> {
  const gate = page.locator('[data-testid="start-reason-gate"]');
  if ((await gate.count()) === 0) return;
  await gate.click({ timeout: 10_000 }).catch(() => {});
}

/**
 * A username no other run holds. Registration is the one step in this suite
 * that writes to a database shared with every other spec and every earlier
 * run, so a fixed name passes once and 409s forever after.
 */
export function uniqueUsername(prefix: string): string {
  return `${prefix}${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 900 + 100)}`;
}

/** Registers a brand-new account through the UI and lands back on the home screen. */
export async function registerNewAccount(page: Page, username: string): Promise<void> {
  // Signed out, the account-only tiles are disabled, so they no longer reach
  // /auth. "Accedi" without `exact` also matches the hero's "Accedi per
  // giocare"; the sign-in button is the unique exact one.
  await page.getByRole("button", { name: "Accedi", exact: true }).click();
  await page.waitForURL(/\/auth/);
  await page.getByRole("tab", { name: "Registrati" }).click();
  await page.getByRole("textbox", { name: "Nome utente" }).fill(username);
  await page.getByRole("textbox", { name: "Password" }).fill("e2e-test-pw");
  await page.getByRole("button", { name: "Crea account" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"));
}
