// tapTargets.spec.ts's sweep, over the two votes the online table offers as pill notices: each
// is measured while it can still be pressed, since a sweep skips a disabled control.
import { test, expect } from "./fixtures";
import { openApp, registerNewAccount, uniqueUsername } from "./helpers/navigation";
import { createRoom, fillWithBotsAndStart, goToOnlineLobby, joinRoom, startRoom } from "./helpers/online";
import { driveGameToCompletion } from "./helpers/bot";
import { settled } from "./helpers/settle";
import { sweepSizes, UNDERSIZED_BY_DESIGN } from "./helpers/tapTargets";
import { it as copy } from "../../locales/it";

const PHONE = { width: 844, height: 390 };

test("the next-hand vote is a full touch target — phone landscape", async ({ page, baseURL }) => {
  test.setTimeout(6 * 60_000);
  await page.setViewportSize(PHONE);

  await openApp(page, baseURL!);
  await registerNewAccount(page, uniqueUsername("tapnext"));
  await goToOnlineLobby(page);
  await createRoom(page, { playerCount: 2, gameMode: "free_for_all" });
  await fillWithBotsAndStart(page);
  const vote = page.getByRole("button", { name: copy["gameOverOverlay.nextHandA11yLabel"], exact: true });
  await driveGameToCompletion(page, { isFinished: () => vote.isVisible() });
  await settled(page, 2500);
  await sweepSizes(page, "next-hand vote", UNDERSIZED_BY_DESIGN, [copy["gameOverOverlay.nextHandA11yLabel"]]);
});

// Three people, since one walking out on a table of two leaves nobody to vote: the match ends.
test("the end-match vote is a full touch target — phone landscape", async ({ page, browser, baseURL }) => {
  test.setTimeout(3 * 60_000);
  const others = await Promise.all([0, 1].map(() => browser.newContext({ locale: "it-IT", viewport: PHONE })));
  try {
    const [stays, leaves] = await Promise.all(others.map((c) => c.newPage()));
    for (const [p, name] of [[stays, "tapstay"], [leaves, "tapleft"]] as const) {
      await openApp(p, baseURL!);
      await registerNewAccount(p, uniqueUsername(name));
    }

    await page.setViewportSize(PHONE);
    await openApp(page, baseURL!);
    await registerNewAccount(page, uniqueUsername("taphost"));
    await goToOnlineLobby(page);
    const code = await createRoom(page, { playerCount: 3, gameMode: "free_for_all" });
    for (const p of [stays, leaves]) {
      await goToOnlineLobby(p);
      await joinRoom(p, code);
    }
    await startRoom(page);
    await leaves.waitForURL(/\/game/);

    await leaves.getByRole("button", { name: copy["gameTable.settingsA11yLabel"] }).click();
    await leaves.getByRole("button", { name: copy["gameSettingsSheet.exit"] }).click();
    await leaves.getByRole("button", { name: copy["onlineGame.quitConfirmConfirm"] }).click();

    await expect(page.getByRole("button", { name: copy["game.endMatchVoteButton"] })).toBeVisible({ timeout: 15_000 });
    await settled(page, 2500);
    await sweepSizes(page, "end-match vote", UNDERSIZED_BY_DESIGN, [copy["game.endMatchVoteButton"]]);
  } finally {
    await Promise.all(others.map((c) => c.close()));
  }
});
