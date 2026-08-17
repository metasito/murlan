import { test } from "./fixtures";
import { openApp, startOfflineGame } from "./helpers/navigation";
import { driveGameToCompletion } from "./helpers/bot";

test("result phone", async ({ page, baseURL }) => {
  test.setTimeout(280_000);
  await page.setViewportSize({ width: 667, height: 375 });
  await openApp(page, baseURL!);
  await startOfflineGame(page, { playerCount: 2, gameMode: "free_for_all", format: "single" });
  await driveGameToCompletion(page, {
    isFinished: async (p) => /\/result/.test(p.url()),
    timeoutMs: 240_000,
    log: (l) => console.log("MOVE " + l),
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "shots/result-phone.png" });
});
