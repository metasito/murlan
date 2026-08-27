// Plays real offline games against AI, end to end, through the rendered UI.
//
// This is the suite that would have caught the exchange-phase freezes and
// the AI-lead deadlock (git history: "Fix three exchange-phase freezes and
// an AI lead deadlock") — those bugs left the table exactly where
// `driveGameToCompletion` refuses to sit quietly: a played move, or a
// giveback, that never changed the table's state.

import { test, expect } from "./fixtures";
import { openApp, startOfflineGame } from "./helpers/navigation";
import { driveGameToCompletion } from "./helpers/bot";

const RESULT_URL = /\/result/;

test.describe("offline vs AI — single hand, reaches a result", () => {
  const configs: {
    name: string;
    playerCount: 2 | 3 | 4;
    gameMode: "free_for_all" | "teams";
  }[] = [
    { name: "2 players, free-for-all", playerCount: 2, gameMode: "free_for_all" },
    { name: "3 players, free-for-all", playerCount: 3, gameMode: "free_for_all" },
    { name: "4 players, free-for-all", playerCount: 4, gameMode: "free_for_all" },
    { name: "4 players, teams", playerCount: 4, gameMode: "teams" },
  ];

  for (const config of configs) {
    test(config.name, async ({ page, baseURL, consoleErrors }) => {
      // How long a hand takes here is decided by the deal, not by the app:
      // the bot never models card legality, it selects a candidate and reads
      // the real GIOCA button to find out (helpers/bot.ts), so a move costs
      // as many clicks as the deal makes it cost. Measured on one run each
      // after that search learned to skip cards that cannot win: 2p 35s,
      // 3p 34s, 4p free-for-all 29s, 4p teams 41s — and the same test has
      // ranged from 49s to over four minutes across deals. Playwright's own
      // budget is the last resort behind `stallMs`, so it sits far above the
      // slow tail rather than at a multiple of the measurements.
      test.setTimeout(5 * 60_000);
      await openApp(page, baseURL!);
      await startOfflineGame(page, {
        playerCount: config.playerCount,
        gameMode: config.gameMode,
        format: "single",
      });

      await driveGameToCompletion(page, {
        isFinished: async (p) => RESULT_URL.test(p.url()),
        log: (line) => test.info().annotations.push({ type: "move", description: line }),
      });

      await expect(page).toHaveURL(RESULT_URL);
      // The rankings list is the result screen's core claim: someone won.
      await expect(page.locator('[data-testid="btn-home"]')).toBeVisible();

      await page.locator('[data-testid="btn-home"]').click();
      await page.waitForURL((url) => url.pathname === "/" || url.pathname === "");

      expect(consoleErrors.entries, "no console errors/warnings during the game").toEqual([]);
    });
  }
});
