// Reaching a started *online* table, the way `offlineSeed.ts` reaches an
// offline one.
//
// There is no seeded shortcut here on purpose. The online table is the screen
// the server deals, and a state conjured into the client would photograph the
// component rather than the product — the whole reason #590 exists. The same
// reasoning rules out biasing the shuffle itself for this suite's sake (#800):
// the deal every seat gets is the real one, and which seat this returns is
// decided by watching all of them, never by asking the server for a friendlier
// one.
//
// It is also the door. A script that drives the app for itself skips
// `openApp`'s tutorial seed, and a run without that seed was measured stalling
// on `/tutorial` for its whole two-minute budget while the same run with it
// reached the room in 1.4s — which is the only mechanism found that produces
// the stall the #57 survey reported, and it is a harness's, not the product's.

import type { Browser, BrowserContext, Page } from "@playwright/test";
import { collectConsoleErrors } from "../fixtures";
import { openApp, registerNewAccount, uniqueUsername } from "./navigation";
import { createRoom, goToOnlineLobby, joinRoom, startRoom, type RoomSetup } from "./online";
import { TABLE, TABLE_STATE } from "./selectors";
import { settled } from "./settle";
import { YOUR_TURN_PREFIX } from "./labels";

/** Long enough for the deal to finish under a loaded runner, short enough to fail rather than hang. */
const DEAL_CEILING_MS = 15_000;

export interface OnlineTableSetup extends RoomSetup {
  /** Overrides the first seat's username. Every other seat is a fresh throwaway account. */
  username?: string;
  /** Applied to every seat's own browser context, so whichever one wins was laid out at this size all along. */
  viewport: { width: number; height: number };
}

export interface OpenedOnlineTable {
  /** The one seat's page the deal actually gave the lead. */
  page: Page;
  /** Every console error/warning/crash any of this table's seats reported, not just the one returned. */
  errors: string[];
  /** Closes every seat's browser context, including the ones never returned. */
  close(): Promise<void>;
}

/**
 * Seats `setup.playerCount` real accounts — one per seat, no bots — at a
 * fresh room and returns whichever one's deal gave it the lead.
 *
 * `findStartingPlayer` (`lib/gameEngine.ts`) hands the lead to whoever holds
 * 3♠ — a real shuffle — or, failing that (only reachable at 2 players, where
 * `dealCards` does not deal the whole deck), to whoever holds the lowest
 * card of the hands actually dealt. Either way it always names one of the
 * players with cards, never nobody: at every seat count this suite uses, the
 * lead is *somewhere* among the seats, not a coin this harness has to keep
 * flipping until it lands on the one seat it happened to be watching. Seating
 * a real account at every chair, instead of bots at every chair but one, is
 * what turns "did the harness land on the lead" from a chance into a lookup —
 * the harness watches every hand as the deal lands and returns the one the
 * table itself named, at first attempt, every attempt.
 *
 * Every seat holds its full dealt hand only until the leader's own turn
 * — the server arms that seat's bot the moment the deal lands
 * (`armTurn`, `server/gameTurn.ts`), on its own clock, independent of how
 * long this harness took to get here. Waiting for "your turn" to arrive,
 * however long that took, used to measure whatever hand of tricks had
 * already played out by then — a table that isn't the one
 * `docs/design/57-polish-audit/` records a freshly-dealt one against (#785).
 * So this checks who led the instant the deal is on screen, before any
 * clock can have fired anywhere at the table — there being no bots left to
 * arm one for.
 *
 * The turn is checked rather than assumed for another reason too: a hand
 * draws its cards at `HAND_SCALE_ON_TURN` when the viewer is on move and at
 * `HAND_SCALE` otherwise (`components/cardFaceModel.ts`), a tenth of the
 * card's height, so a caller that measures without it measures two
 * different tables depending on which seat the server dealt first.
 */
export async function openOnlineTable(
  browser: Browser,
  baseURL: string,
  setup: OnlineTableSetup
): Promise<OpenedOnlineTable> {
  const seatCount = setup.playerCount;
  const contexts: BrowserContext[] = await Promise.all(
    Array.from({ length: seatCount }, () =>
      browser.newContext({ locale: "it-IT", viewport: setup.viewport })
    )
  );
  const seats = await Promise.all(
    contexts.map(async (context) => {
      const page = await context.newPage();
      await page.emulateMedia({ reducedMotion: "reduce" });
      return { page, errors: collectConsoleErrors(page).entries };
    })
  );
  const errors = seats.flatMap((s) => s.errors);

  const close = () => Promise.all(contexts.map((c) => c.close())).then(() => undefined);

  try {
    const usernames = Array.from({ length: seatCount }, (_, i) =>
      i === 0 && setup.username ? setup.username : uniqueUsername(`online${i}`)
    );

    const host = seats[0].page;
    await openApp(host, baseURL);
    await registerNewAccount(host, usernames[0]);
    await goToOnlineLobby(host);
    const code = await createRoom(host, setup);

    // Sequential, not `Promise.all`: this suite's own webServer is one Node
    // process shared by every seat's bundle load, and this machine runs
    // another agent's session beside it (RULES.md 37) — `seatCount - 1`
    // contexts loading it at once is more peak memory than one at a time
    // needs to spend.
    for (let i = 1; i < seats.length; i++) {
      const { page } = seats[i];
      await openApp(page, baseURL);
      await registerNewAccount(page, usernames[i]);
      await goToOnlineLobby(page);
      await joinRoom(page, code);
    }

    await startRoom(host);
    await Promise.all(
      seats.map(({ page }) => page.locator(TABLE).waitFor({ timeout: DEAL_CEILING_MS }))
    );

    let leaderIdx = -1;
    for (let i = 0; i < seats.length; i++) {
      const leads =
        (await seats[i].page
          .locator(`${TABLE}[${TABLE_STATE}^="${YOUR_TURN_PREFIX}"]`)
          .count()) > 0;
      if (leads) {
        leaderIdx = i;
        break;
      }
    }
    if (leaderIdx === -1) {
      throw new Error(
        `none of the ${seatCount} seats were dealt the lead. findStartingPlayer ` +
          `(lib/gameEngine.ts) always names one of the players holding cards — so with every ` +
          `seat here a real, dealt-into account, this is the turn indicator disagreeing with ` +
          `the engine, not an unlucky shuffle`
      );
    }

    const winner = seats[leaderIdx].page;
    await settled(winner, DEAL_CEILING_MS);
    return { page: winner, errors, close };
  } catch (err) {
    await close();
    throw err;
  }
}
