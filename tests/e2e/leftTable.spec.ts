// #1731: the next-round vote deadline hands a silent, still-connected player's seat to a bot. That
// player is told so and takes the seat back only by pressing for it, and comes back with a hand.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openApp, registerNewAccount, uniqueUsername } from "./helpers/navigation";
import { createRoom, goToOnlineLobby, joinRoom, startRoom } from "./helpers/online";
import { driveGameToCompletion } from "./helpers/bot";
import { HAND_CARDS } from "./helpers/selectors";
import { it as copy } from "../../locales/it";

// The server's own default (`voteDeadlineMs`, server/game/gameTimers.ts): the shared e2e server
// cannot shorten it for one spec without shortening it under every other spec that sits on a result.
const VOTE_DEADLINE_MS = 30_000;

const nextRoundVote = (page: Page) =>
  page.getByRole("button", { name: copy["roundOverOverlay.nextRoundA11yLabel"], exact: true });
const reclaim = (page: Page) => page.getByRole("button", { name: copy["onlineGame.leftTableReclaim"], exact: true });

test("online — a player vacated by the vote deadline sees it, and takes the seat back with a hand", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(8 * 60_000);
  const contexts = await Promise.all([0, 1].map(() => browser.newContext({ locale: "it-IT" })));
  try {
    const [voter, silent] = await Promise.all(contexts.map((c) => c.newPage()));
    for (const [p, name] of [[voter, "e2evote"], [silent, "e2esilent"]] as const) {
      await p.emulateMedia({ reducedMotion: "reduce" });
      await openApp(p, baseURL!);
      await registerNewAccount(p, uniqueUsername(name));
    }

    await goToOnlineLobby(voter);
    const code = await createRoom(voter, { playerCount: 2, gameMode: "free_for_all" });
    await goToOnlineLobby(silent);
    await joinRoom(silent, code);
    await startRoom(voter);
    await silent.waitForURL(/\/game/);

    await Promise.all(
      [voter, silent].map((p) => driveGameToCompletion(p, { isFinished: () => nextRoundVote(p).isVisible() }))
    );
    await nextRoundVote(voter).click();

    await expect(silent.getByTestId("left-table")).toBeVisible({ timeout: VOTE_DEADLINE_MS + 30_000 });
    await expect(silent.getByTestId("notice-leftTable").getByText(copy["onlineGame.leftTableTitle"])).toBeVisible();
    await expect(nextRoundVote(silent), "the panel stands in the vote's place").toHaveCount(0);
    await expect(silent.getByRole("button", { name: copy["onlineGame.leftTableLeave"], exact: true })).toBeVisible();

    await reclaim(silent).click();

    await expect(silent.getByTestId("left-table")).toHaveCount(0, { timeout: 30_000 });
    await expect
      .poll(() => silent.locator(HAND_CARDS).count(), { message: "seated again, with a hand", timeout: 30_000 })
      .toBeGreaterThan(0);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
