// Plays a real offline match against AI, end to end, through the rendered UI:
// several hands, each ending on the table into the next deal, and the card
// exchange that runs between them.
//
// Its own file rather than a case in offline.spec.ts because it is the
// suite's longest single test by a wide margin, and a spec file is the unit
// CI hands to a shard (tools/ci/e2e-shard.mjs).

import { test, expect } from "./fixtures";
import { openApp, startOfflineGame } from "./helpers/navigation";
import { driveGameToCompletion, untilNextDeal } from "./helpers/bot";

const GAME_URL = /\/game/;

test("offline vs AI — a match plays multiple hands on the table and exercises the card exchange between them", async ({
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
  const visited: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) visited.push(frame.url());
  });

  // A 2-player match awards the hand winner 1 point (lib/game/gameEngine.ts
  // `scoreHand`) against a target of 7 (`targetsFor(2)`), so reaching
  // match.over takes at least seven hands. This suite only needs to prove the
  // between-hands transition works, so it plays a small fixed number of hands
  // and then leaves deliberately.
  const HANDS_TO_PLAY = 2;
  for (let hand = 1; hand <= HANDS_TO_PLAY; hand++) {
    await driveGameToCompletion(page, {
      isFinished: untilNextDeal(),
      log: (line) =>
        test.info().annotations.push({ type: "move", description: `hand ${hand}: ${line}` }),
    });
    await expect(page).toHaveURL(GAME_URL);
  }
  expect(visited.filter((url) => !GAME_URL.test(url)), "a manche never leaves the table").toEqual([]);

  await page.getByRole("button", { name: "Impostazioni" }).click();
  await page.getByRole("button", { name: "Esci dalla partita" }).click();
  await page.getByTestId("confirm-accept").click();
  await page.waitForURL((url) => url.pathname === "/" || url.pathname === "");

  expect(consoleErrors.entries, "no console errors/warnings across the whole match").toEqual([]);
});
