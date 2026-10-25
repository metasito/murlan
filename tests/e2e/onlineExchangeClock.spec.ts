// The exchange winner online is under the server's AFK deadline (docs/GAME-RULES.md § Decisions,
// "The turn clock"), so their chip counts it down. Two real accounts play a round out and vote;
// whichever one the next deal makes the exchange winner is the one asked.
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { dismissStartAnnouncement, openApp, registerNewAccount, uniqueUsername } from "./helpers/navigation";
import { createRoom, goToOnlineLobby, joinRoom, startRoom } from "./helpers/online";
import { driveGameToCompletion } from "./helpers/bot";

const nextRoundVote = (page: Page) => page.getByRole("button", { name: "Pronto per la prossima manche", exact: true });
/** The prompt's wrapper is on both seats' chips; only the winner's reads "Scegli una carta". */
const WINNER_PROMPT = '[data-testid="exchange-prompt"]:has-text("Scegli una carta")';
const CHIP_COUNT = '[data-testid="turn-chip-count"]';
const SHOTS = process.env.E2E_SHOTS_DIR;

test("online — the exchange winner's chip counts the server's clock down", async ({ browser, baseURL }) => {
  test.setTimeout(7 * 60_000);
  const contexts = [await browser.newContext({ locale: "it-IT", viewport: { width: 844, height: 390 } }), await browser.newContext({ locale: "it-IT", viewport: { width: 844, height: 390 } })];
  try {
    const pages = await Promise.all(contexts.map((c) => c.newPage()));
    for (const [i, p] of pages.entries()) {
      await p.emulateMedia({ reducedMotion: "reduce" });
      await openApp(p, baseURL!);
      await registerNewAccount(p, uniqueUsername(`e2ex${i}`));
    }
    await goToOnlineLobby(pages[0]);
    const code = await createRoom(pages[0], { playerCount: 2, gameMode: "free_for_all" });
    await goToOnlineLobby(pages[1]);
    await joinRoom(pages[1], code);
    await startRoom(pages[0]);
    await pages[1].waitForURL(/\/game/);

    await Promise.all(pages.map((p) => driveGameToCompletion(p, { isFinished: (q) => nextRoundVote(q).isVisible() })));
    for (const p of pages) await nextRoundVote(p).click();

    let winner = -1;
    await expect
      .poll(async () => {
        await Promise.all(pages.map(dismissStartAnnouncement));
        const asked = await Promise.all(pages.map((p) => p.locator(WINNER_PROMPT).isVisible()));
        winner = asked.indexOf(true);
        return winner;
      }, { timeout: 25_000, message: "the next deal made one of them the exchange winner" })
      .toBeGreaterThanOrEqual(0);
    const page = pages[winner];

    await expect(page.locator(CHIP_COUNT), "the winner's chip counts the server's seconds down").toBeVisible();
    const count = Number(await page.locator(CHIP_COUNT).textContent());
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(30);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "online-exchange-winner-clock.png") });
  } finally {
    for (const c of contexts) await c.close();
  }
});
