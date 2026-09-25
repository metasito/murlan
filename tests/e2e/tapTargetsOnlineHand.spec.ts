// tapTargets.spec.ts's sweep, after an online hand: minutes of bot play on their own, so in a
// file of their own the shard split can place them apart from the rest.
import { test, expect } from "./fixtures";
import { openApp, registerNewAccount, uniqueUsername } from "./helpers/navigation";
import { createRoom, fillWithBotsAndStart, goToOnlineLobby } from "./helpers/online";
import { driveGameToCompletion } from "./helpers/bot";
import { settled } from "./helpers/settle";
import { sweepSizes, UNDERSIZED_BY_DESIGN } from "./helpers/tapTargets";
import { it as copy } from "../../locales/it";

// One size: an online match played out is minutes of bot play, and the overlay,
// the breakdown and the replay only exist after one.
test("no control is undersized after an online hand — phone landscape", async ({ page, baseURL }) => {
  test.setTimeout(8 * 60_000);
  await page.setViewportSize({ width: 844, height: 390 });

  await openApp(page, baseURL!);
  await registerNewAccount(page, uniqueUsername("tapover"));
  await goToOnlineLobby(page);
  await createRoom(page, { playerCount: 2, gameMode: "free_for_all" });
  await page.getByRole("radio", { name: /Manche secca/ }).first().click();
  await fillWithBotsAndStart(page);
  await driveGameToCompletion(page, {
    isFinished: (p) => p.getByRole("button", { name: "Esci dalla partita" }).isVisible(),
  });
  await settled(page, 2500);
  await sweepSizes(page, "match over", UNDERSIZED_BY_DESIGN);

  await page.getByRole("button", { name: copy["handBreakdown.toggleA11yLabel"] }).click();
  await expect(page.getByRole("button", { name: copy["handBreakdown.openReplayA11yLabel"] })).toBeVisible({
    timeout: 15_000,
  });
  await settled(page, 1500);
  await sweepSizes(page, "hand breakdown", UNDERSIZED_BY_DESIGN);

  await page.goto(`${baseURL!}/profile`);
  const replayRow = page.getByRole("button", { name: /^Guarda:/ }).first();
  await expect(replayRow).toBeVisible({ timeout: 15_000 });
  await settled(page, 2500);
  await sweepSizes(page, "profile, after a hand");

  await replayRow.click();
  await page.waitForURL(/replay/, { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Riproduci" })).toBeVisible();
  await settled(page, 2500);
  await sweepSizes(page, "replay", UNDERSIZED_BY_DESIGN);
});
