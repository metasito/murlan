// Reaching a started *online* table, the way `offlineSeed.ts` reaches an
// offline one.
//
// There is no seeded shortcut here on purpose. The online table is the screen
// the server deals, and a state conjured into the client would photograph the
// component rather than the product — the whole reason #590 exists. Driving the
// real path costs about 1.5s to a dealt table at every viewport this suite
// runs, measured, so fidelity is free.
//
// It is also the door. A script that drives the app for itself skips
// `openApp`'s tutorial seed, and a run without that seed was measured stalling
// on `/tutorial` for its whole two-minute budget while the same run with it
// reached the room in 1.4s — which is the only mechanism found that produces
// the stall the #57 survey reported, and it is a harness's, not the product's.

import type { Page } from "@playwright/test";
import { openApp, registerNewAccount, uniqueUsername } from "./navigation";
import { createRoom, fillWithBotsAndStart, goToOnlineLobby, type RoomSetup } from "./online";
import { TABLE, TABLE_STATE } from "./selectors";
import { settled } from "./settle";
import { YOUR_TURN_PREFIX } from "./labels";

/** Long enough for the deal to finish under a loaded runner, short enough to fail rather than hang. */
const DEAL_CEILING_MS = 15_000;

/**
 * How many rooms to deal before giving up on the viewer leading one.
 *
 * `findStartingPlayer` (`lib/gameEngine.ts`) hands the lead to whoever holds
 * 3♠ — a real shuffle, so at four players the viewer draws it about a
 * quarter of the time. 20 puts the odds of exhausting this under one in a
 * thousand.
 */
const MAX_DEAL_ATTEMPTS = 20;

export interface OnlineTableSetup extends RoomSetup {
  /** Defaults to a fresh throwaway account. */
  username?: string;
}

/**
 * Registers, creates a room, fills it with bots and returns once the dealt
 * table has stopped moving, on the viewer's own opening turn.
 *
 * Every seat holds its full dealt hand only until the leader's own turn
 * — the server arms that seat's bot the moment the deal lands
 * (`armTurn`, `server/gameTurn.ts`), on its own clock, independent of how
 * long this harness took to get here. Waiting for "your turn" to arrive,
 * however long that took, used to measure whatever hand of tricks had
 * already played out by then — a table that isn't the one
 * `docs/design/57-polish-audit/` records a freshly-dealt one against (#785).
 * So this checks who led the instant the deal is on screen, before any bot's
 * timer can have fired, and deals again when it wasn't the viewer — the one
 * way to reach the viewer's turn with nothing yet played, since nothing
 * short of holding 3♠ lets them act first.
 *
 * The turn is checked rather than assumed for another reason too: a hand
 * draws its cards at `HAND_SCALE_ON_TURN` when the viewer is on move and at
 * `HAND_SCALE` otherwise (`components/cardFaceModel.ts`), a tenth of the
 * card's height, so a caller that measures without it measures two
 * different tables depending on which seat the server dealt first.
 *
 * A losing deal is retried with a whole new account rather than a new room
 * on the same one: the room screen keeps a hidden landscape/portrait twin of
 * its own markup mounted (two "CODICE STANZA" nodes for one room, worked
 * around below), and re-creating a room on it once left a "Crea Stanza"
 * click landing on a node the leave had already begun tearing down — the
 * click succeeded, the room never was. Signing out is not the cookie-clear
 * this replaced, either: clearing cookies under a page whose socket is still
 * connected races its own reconnect and auth probe against credentials that
 * just went stale, which the browser reports as 401s and a closed WebSocket
 * — real console noise `consoleErrors` (fixtures.ts) then fails the test
 * over. Leaving the room first, through the same quit flow a real player
 * uses (`onExit` in `GameTable.tsx`), settles its socket state before the
 * settings sheet's own `logout()` ever runs.
 */
export async function openOnlineTable(
  page: Page,
  baseURL: string,
  setup: OnlineTableSetup
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    await openApp(page, baseURL);
    await registerNewAccount(page, setup.username ?? uniqueUsername("online"));
    await goToOnlineLobby(page);
    await createRoom(page, setup);
    await fillWithBotsAndStart(page);
    await page.locator(TABLE).waitFor({ timeout: DEAL_CEILING_MS });
    const viewerLeads =
      (await page.locator(`${TABLE}[${TABLE_STATE}^="${YOUR_TURN_PREFIX}"]`).count()) > 0;
    if (viewerLeads) break;
    if (attempt >= MAX_DEAL_ATTEMPTS) {
      throw new Error(`the viewer was not dealt the lead in ${MAX_DEAL_ATTEMPTS} rooms in a row`);
    }
    await page.getByRole("button", { name: "Impostazioni" }).first().click();
    await page.getByTestId("settings-exit").click();
    await page.getByTestId("confirm-accept").click();
    await page.getByRole("button", { name: "Crea Stanza" }).waitFor();
    await page.goto(baseURL);
    await page.getByRole("button", { name: "Impostazioni" }).first().click();
    await page.getByRole("button", { name: "Esci da questo account" }).click();
    await page.getByTestId("confirm-accept").click();
    await page.waitForURL(/\/auth/);
  }
  await settled(page, DEAL_CEILING_MS);
}
