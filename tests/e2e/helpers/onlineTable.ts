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

/** How long the bots ahead of the viewer may take before their turn counts as stuck. */
const VIEWER_TURN_CEILING_MS = 60_000;

export interface OnlineTableSetup extends RoomSetup {
  /** Defaults to a fresh throwaway account. */
  username?: string;
}

/**
 * Registers, creates a room, fills it with bots and returns once the dealt
 * table has stopped moving, on the viewer's own turn.
 *
 * The turn is waited for rather than taken as it comes: a hand draws its cards
 * at `HAND_SCALE_ON_TURN` when the viewer is on move and at `HAND_SCALE`
 * otherwise (`components/cardFaceModel.ts`), which is a tenth of the card's
 * height, so a caller that measures whenever the deal lands measures two
 * different tables depending on which seat the server dealt first.
 */
export async function openOnlineTable(
  page: Page,
  baseURL: string,
  setup: OnlineTableSetup
): Promise<void> {
  await openApp(page, baseURL);
  await registerNewAccount(page, setup.username ?? uniqueUsername("online"));
  await goToOnlineLobby(page);
  await createRoom(page, setup);
  await fillWithBotsAndStart(page);
  await page.locator(TABLE).waitFor({ timeout: DEAL_CEILING_MS });
  await page
    .locator(`${TABLE}[${TABLE_STATE}^="${YOUR_TURN_PREFIX}"]`)
    .waitFor({ timeout: VIEWER_TURN_CEILING_MS });
  await settled(page, DEAL_CEILING_MS);
}
