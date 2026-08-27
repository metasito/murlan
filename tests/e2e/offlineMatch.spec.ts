// Plays a real offline match against AI, end to end, through the rendered UI:
// several hands, and the card exchange that runs between them.
//
// Its own file rather than a case in offline.spec.ts because it is the
// suite's longest single test by a wide margin, and a spec file is the unit
// CI hands to a shard (scripts/e2e-shard.mjs).

import { test, expect } from "./fixtures";
import { openApp, startOfflineGame } from "./helpers/navigation";
import { driveGameToCompletion } from "./helpers/bot";

const RESULT_URL = /\/result/;

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

  // A 2-player match awards the hand winner 1 point (lib/gameEngine.ts
  // `scoreHand`) against a target of 7 (`targetsFor(2)`), so reaching
  // match.over takes at least seven hands. This suite only needs to prove the
  // between-hands exchange transition works, so it plays a small fixed number
  // of hands and then leaves deliberately, rather than waiting for the match
  // to conclude on its own.
  const HANDS_TO_PLAY = 2;
  for (let hand = 1; hand <= HANDS_TO_PLAY; hand++) {
    await driveGameToCompletion(page, {
      isFinished: async (p) => RESULT_URL.test(p.url()),
      log: (line) =>
        test.info().annotations.push({ type: "move", description: `hand ${hand}: ${line}` }),
    });
    await expect(page).toHaveURL(RESULT_URL);

    if (hand === HANDS_TO_PLAY) break;
    await page.locator('[data-testid="btn-prossima-manche"]').click();
    await page.waitForURL(/\/game/);
  }

  await page.locator('[data-testid="btn-home"]').click();
  await page.waitForURL((url) => url.pathname === "/" || url.pathname === "");

  expect(consoleErrors.entries, "no console errors/warnings across the whole match").toEqual([]);
});
