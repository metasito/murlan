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
      // 3p 34s, 4p free-for-all 29s, 4p teams 41s.
      //
      // The budget stays far above those rather than a tight multiple,
      // because the spread across deals is the whole point — the same test
      // has ranged from 49s to over 4 minutes. It is not the check either. A
      // game that is actually broken is caught by `stallMs`, 15s with the
      // table description unchanged, which is untouched and fails in seconds
      // with the state it stopped in. This only stops a runaway from hanging
      // the suite.
      const driveTimeoutMs = 5 * 60_000;
      test.setTimeout(driveTimeoutMs + 30_000);
      await openApp(page, baseURL!);
      await startOfflineGame(page, {
        playerCount: config.playerCount,
        gameMode: config.gameMode,
        format: "single",
      });

      await driveGameToCompletion(page, {
        isFinished: async (p) => RESULT_URL.test(p.url()),
        timeoutMs: driveTimeoutMs,
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

test("offline vs AI — a match plays multiple hands and exercises the card exchange between them", async ({
  page,
  baseURL,
  consoleErrors,
}) => {
  test.setTimeout(5 * 60_000);
  await openApp(page, baseURL!);
  await startOfflineGame(page, {
    playerCount: 2,
    gameMode: "free_for_all",
    format: "match", // the lobby's default: first to the target score, hands separated by a card exchange
  });

  // A 2-player match awards the hand winner only 1 point (lib/gameEngine.ts
  // `scoreHand`) against a target of 21+ (MATCH_TARGETS) — reaching
  // match.over could take dozens of hands. This suite only needs to prove
  // the between-hands exchange transition works, so it plays a small fixed
  // number of hands and then leaves deliberately, rather than waiting for
  // the match to conclude on its own.
  const HANDS_TO_PLAY = 2;
  for (let hand = 1; hand <= HANDS_TO_PLAY; hand++) {
    await driveGameToCompletion(page, {
      isFinished: async (p) => RESULT_URL.test(p.url()),
      timeoutMs: 2 * 60_000,
      log: (line) =>
        test.info().annotations.push({ type: "move", description: `hand ${hand}: ${line}` }),
    });
    await expect(page).toHaveURL(RESULT_URL);

    if (hand === HANDS_TO_PLAY) break;
    await page.locator('[data-testid="btn-prossima-manche"]').click();
    await page.waitForURL(/\/game/);
  }

  // Setting up the next hand can itself land on the two-joker exception
  // (docs/RULES.md §10 — the loser holding both Jokers skips the exchange
  // outright) shown as a confirmation overlay right on this result screen,
  // covering the Home button until dismissed. Either outcome is a clean
  // finish for this test: what matters is that the hand-transition and
  // exchange machinery kept moving, not which of the two ends it on.
  const bothJokersOk = page.getByRole("button", { name: "OK, inizia!" });
  if (await bothJokersOk.count()) {
    await bothJokersOk.click();
    await page.waitForURL(/\/game/);
    await expect(page.locator('[data-testid="game-table"]')).toBeVisible();
  } else {
    await page.locator('[data-testid="btn-home"]').click();
    await page.waitForURL((url) => url.pathname === "/" || url.pathname === "");
  }

  expect(consoleErrors.entries, "no console errors/warnings across the whole match").toEqual([]);
});
